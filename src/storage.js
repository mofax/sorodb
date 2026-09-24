// @ts-check
import { DbBuilder, IsolationLevel, ObjectStore } from "@slatedb/uniffi";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SchemaError, CursorError } from "./errors.js";
import { compileSchema, schemaDiff, validateDocument } from "./schema.js";
import { addIndexes } from "./indexes.js";
import {
	decodeData,
	docKey,
	docPrefix,
	encodeData,
	indexPrefix,
	range,
	stable,
} from "./encoding.js";
import { Collection } from "./collection.js";

const META_KEY = Buffer.from("M\0schema");
const CURSOR_TTL = 5 * 60 * 1000;

/** @param {import("./types.js").Reader} reader @param {Uint8Array} prefix @param {Uint8Array} [after] */
export async function* scan(reader, prefix, after) {
	const iterator = await reader.scan(range(prefix, after));
	try {
		while (true) {
			const row = await iterator.next();
			if (!row) {
				return;
			}
			yield { key: Buffer.from(row.key), value: Buffer.from(row.value) };
		}
	} finally {
		iterator.dispose();
	}
}

export class Database {
	/** @param {import("./types.js").DatabaseConfig} config */
	constructor(config) {
		if (
			!config ||
			typeof config.store !== "string" ||
			typeof config.path !== "string" ||
			!config.path
		) {
			throw new SchemaError("SoroDB needs { store: URL, path: nonempty string }");
		}
		this.config = config;
		if (
			config.cursorTtlMs !== undefined &&
			(!Number.isSafeInteger(config.cursorTtlMs) || config.cursorTtlMs < 1)
		) {
			throw new SchemaError("cursorTtlMs must be a positive integer");
		}
		this.cursorTtlMs = config.cursorTtlMs ?? CURSOR_TTL;
		this.definition = null;
		this.native = null;
		this.store = null;
		this.opening = null;
		this.closed = false;
		/** @type {Map<string, import("./types.js").Session>} */
		this.sessions = new Map();
	}

	/** @param {{ version: number }} config @param {import("./types.js").TableDefinition[]} definitions */
	schema(config, definitions) {
		if (this.opening || this.native || this.closed) {
			throw new SchemaError("Register the schema before opening the database");
		}
		this.definition = compileSchema(config, definitions);
		return this;
	}

	async _ready() {
		if (this.closed) {
			throw new SchemaError("Database is closed");
		}
		if (!this.definition) {
			throw new SchemaError("Register a schema before using collections");
		}
		if (!this.opening) {
			this.opening = this._open();
		}
		return this.opening;
	}

	async _open() {
		const definition = this.definition;
		if (!definition) {
			throw new SchemaError("Register a schema before opening the database");
		}
		// SlateDB 0.16 accepts the filesystem location in DbBuilder's path, not
		// in ObjectStore.resolve's URL. Keep the friendlier SoroDB config shape.
		const local = this.config.store.startsWith("file:");
		let storeUrl = this.config.store;
		let databasePath = this.config.path;
		if (local) {
			storeUrl = "file:///";
			databasePath = join(fileURLToPath(this.config.store), this.config.path);
		}
		this.store = ObjectStore.resolve(storeUrl);
		const builder = new DbBuilder(databasePath, this.store);
		try {
			this.native = await builder.build();
		} catch (error) {
			this.store.dispose();
			this.store = null;
			throw error;
		} finally {
			builder.dispose();
		}
		try {
			const bytes = await this.native.get(META_KEY);
			if (!bytes) {
				await this.native.put(META_KEY, encodeData(definition.stored));
			} else {
				const previous = decodeData(bytes);
				const diff = schemaDiff(previous, definition.stored);
				if (diff.changed) {
					await this._migrate(diff);
				}
			}
		} catch (error) {
			await this.native.shutdown().catch(() => {});
			this.native.dispose();
			this.store.dispose();
			this.native = null;
			this.store = null;
			throw error;
		}
	}

	/** @param {import("./types.js").SchemaDiff} diff */
	async _migrate(diff) {
		const definition = this.definition;
		const native = this.native;
		if (!definition || !native) {
			throw new SchemaError("Database is not open");
		}
		for (const [name, changes] of diff.additions) {
			if (!changes.columns.length && !changes.indexes.length) {
				continue;
			}
			const table = definition.tables.get(name);
			if (!table) {
				throw new SchemaError(`Collection ${name} is absent from the schema`);
			}
			// A prior attempt may have stopped after writing some entries. Rebuild only
			// indexes newly introduced by this version before exposing the schema.
			for (const index of changes.indexes) {
				for await (const row of scan(native, indexPrefix(name, index.name))) {
					await native.delete(row.key);
				}
			}
			for await (const row of scan(native, docPrefix(name))) {
				const before = decodeData(row.value);
				const after = validateDocument(table, before);
				const changed = stable(before) !== stable(after);
				const tx = await native.begin(IsolationLevel.SerializableSnapshot);
				try {
					if (changed) {
						await tx.put(docKey(name, after.id), encodeData(after));
					}
					if (changes.indexes.length) {
						await addIndexes(tx, table, after, changes.indexes);
					}
					await tx.commit();
				} catch (error) {
					await tx.rollback().catch(() => {});
					throw error;
				} finally {
					tx.dispose();
				}
			}
		}
		await native.put(META_KEY, encodeData(definition.stored));
	}

	/** @param {string} name */
	async collection(name) {
		await this._ready();
		if (!this.definition) {
			throw new SchemaError("Register a schema before using collections");
		}
		const table = this.definition.tables.get(name);
		if (!table) {
			throw new SchemaError(`Collection ${name} is absent from the schema`);
		}
		return new Collection(this, table);
	}

	/** @template T @param {(tx: import("@slatedb/uniffi").DbTransaction) => Promise<T>} fn @returns {Promise<T>} */
	async _atomic(fn) {
		await this._ready();
		if (!this.native) {
			throw new SchemaError("Database is not open");
		}
		const tx = await this.native.begin(IsolationLevel.SerializableSnapshot);
		try {
			const result = await fn(tx);
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback().catch(() => {});
			throw error;
		} finally {
			tx.dispose();
		}
	}

	/** @template T @param {(tx: { collection: (name: string) => Promise<Collection> }) => Promise<T>} callback @returns {Promise<T>} */
	async transaction(callback) {
		if (typeof callback !== "function") {
			throw new SchemaError("transaction requires a callback");
		}
		const definition = this.definition;
		if (!definition) {
			throw new SchemaError("Register a schema before using collections");
		}
		return this._atomic(async (native) => {
			/** @type {{ collection: (name: string) => Promise<Collection> }} */
			const tx = {
				collection: async (name) => {
					const table = definition.tables.get(name);
					if (!table) {
						throw new SchemaError(`Collection ${name} is absent from the schema`);
					}
					return new Collection(this, table, native);
				},
			};
			return callback(tx);
		});
	}

	_session() {
		const now = Date.now();
		for (const [id, session] of this.sessions) {
			if (!session.active && session.lastUsed + this.cursorTtlMs < now) {
				this._releaseSession(id);
			}
		}
	}

	/** @param {string} fingerprint */
	async _newSession(fingerprint) {
		await this._ready();
		if (!this.native) {
			throw new SchemaError("Database is not open");
		}
		this._session();
		const id = randomUUID();
		const snapshot = await this.native.snapshot();
		const session = { snapshot, fingerprint, lastUsed: Date.now(), active: 0 };
		this.sessions.set(id, session);
		this._armSession(id, session);
		return { id, session };
	}

	/** @param {string} id @param {import("./types.js").Session} session */
	_armSession(id, session) {
		clearTimeout(session.timer);
		if (session.active) {
			return;
		}
		session.timer = setTimeout(() => this._releaseSession(id), this.cursorTtlMs);
		session.timer.unref?.();
	}

	/** @param {import("./types.js").Session} session */
	_holdSession(session) {
		session.active++;
		clearTimeout(session.timer);
	}

	/** @param {string} id */
	_idleSession(id) {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}
		session.active--;
		session.lastUsed = Date.now();
		this._armSession(id, session);
	}

	/** @param {string} id @param {string} fingerprint */
	_getSession(id, fingerprint) {
		this._session();
		const session = this.sessions.get(id);
		if (!session || session.fingerprint !== fingerprint) {
			throw new CursorError("Cursor is expired or belongs to a different query");
		}
		session.lastUsed = Date.now();
		this._armSession(id, session);
		return session;
	}

	/** @param {string} id */
	_releaseSession(id) {
		const session = this.sessions.get(id);
		if (session) {
			clearTimeout(session.timer);
			session.snapshot.dispose();
			this.sessions.delete(id);
		}
	}

	async close() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		if (this.opening) {
			await this.opening.catch(() => {});
		}
		for (const id of this.sessions.keys()) {
			this._releaseSession(id);
		}
		if (this.native) {
			try {
				await this.native.shutdown();
			} finally {
				this.native.dispose();
				this.native = null;
			}
		}
		if (this.store) {
			this.store.dispose();
			this.store = null;
		}
	}
}
