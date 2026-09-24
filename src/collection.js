// @ts-check
import { ConflictError, SchemaError, ValidationError } from "./errors.js";
import { decodeData, docKey, encodeData } from "./encoding.js";
import { validateDocument } from "./schema.js";
import { addIndexes, removeIndexes } from "./indexes.js";
import { Query } from "./query.js";

export class Collection {
	/** @param {import("./storage.js").Database} db @param {import("./types.js").Table} table @param {import("@slatedb/uniffi").DbTransaction | null} [transaction] */
	constructor(db, table, transaction = null) {
		this.db = db;
		this.table = table;
		this.transaction = transaction;
	}

	/** @template T @param {(tx: import("@slatedb/uniffi").DbTransaction) => Promise<T>} callback @returns {Promise<T>} */
	async _write(callback) {
		if (this.transaction) {
			return callback(this.transaction);
		}
		return this.db._atomic(callback);
	}

	/** @param {import("./types.js").Document} document */
	async create(document) {
		const value = validateDocument(this.table, document);
		const key = docKey(this.table.name, value.id);
		return this._write(async (tx) => {
			if (await tx.get(key)) {
				throw new ConflictError(`${this.table.name} id already exists`);
			}
			await tx.put(key, encodeData(value));
			await addIndexes(tx, this.table, value);
			return value;
		});
	}

	/** @param {string | number} id */
	async get(id) {
		await this.db._ready();
		const reader = this.transaction ?? this.db.native;
		if (!reader) {
			throw new SchemaError("Database is not open");
		}
		const bytes = await reader.get(docKey(this.table.name, id));
		if (bytes) {
			return decodeData(bytes);
		}
		return null;
	}

	/** @param {string | number} id @param {import("./types.js").Document} document */
	async replace(id, document) {
		if (!document || document.id !== id) {
			throw new ValidationError("Replacement document must retain the same id");
		}
		const value = validateDocument(this.table, document);
		const key = docKey(this.table.name, id);
		return this._write(async (tx) => {
			const bytes = await tx.get(key);
			if (!bytes) {
				throw new ConflictError(`${this.table.name} id does not exist`);
			}
			const before = decodeData(bytes);
			await removeIndexes(tx, this.table, before);
			await tx.put(key, encodeData(value));
			await addIndexes(tx, this.table, value);
			return value;
		});
	}

	/** @param {string | number} id */
	async delete(id) {
		const key = docKey(this.table.name, id);
		return this._write(async (tx) => {
			const bytes = await tx.get(key);
			if (!bytes) {
				return false;
			}
			await removeIndexes(tx, this.table, decodeData(bytes));
			await tx.delete(key);
			return true;
		});
	}

	/** @param {import("./types.js").QueryOptions} [options] */
	filter(options = {}) {
		return new Query(this, options);
	}
}
