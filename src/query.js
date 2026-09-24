// @ts-check
import { createHash } from "node:crypto";
import { CursorError, QueryError } from "./errors.js";
import { decodeData, docKey, docPrefix, getPath, indexPrefix, stable } from "./encoding.js";
import { indexMethod } from "./index-methods.js";
import { scan } from "./storage.js";

/** @param {string} path */
const checkPath = (path) => {
	if (typeof path !== "string" || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(path) || path.includes("..")) {
		throw new QueryError("Field path must be a dotted name");
	}
	return path;
};

/** @returns {import("./types.js").WhereBuilder} */
function whereBuilder() {
	/** @param {import("./types.js").Predicate["op"]} op */
	const comparison = (op) => {
		/** @param {string} path @param {unknown} value */
		return (path, value) => ({ op, path: checkPath(path), value });
	};
	return Object.freeze({
		eq: comparison("eq"),
		ne: comparison("ne"),
		gt: comparison("gt"),
		gte: comparison("gte"),
		lt: comparison("lt"),
		lte: comparison("lte"),
		in: comparison("in"),
		contains: comparison("contains"),
		startsWith: comparison("startsWith"),
		exists: (path, value = true) => ({
			op: "exists",
			path: checkPath(path),
			value: value === true,
		}),
		and: (...conditions) => ({ op: "and", conditions }),
		or: (...conditions) => ({ op: "or", conditions }),
		not: (condition) => ({ op: "not", condition }),
	});
}

/** @param {((builder: import("./types.js").OrderBuilder) => unknown) | undefined} callback @returns {import("./types.js").IndexField[]} */
function compileOrder(callback) {
	if (callback === undefined) {
		return [];
	}
	if (typeof callback !== "function") {
		throw new QueryError("orderBy must be a callback");
	}
	/** @type {import("./types.js").IndexField[]} */
	const fields = [];
	/** @type {import("./types.js").OrderBuilder} */
	const builder = {
		asc(path) {
			fields.push({ name: checkPath(path), direction: "asc" });
			return builder;
		},
		desc(path) {
			fields.push({ name: checkPath(path), direction: "desc" });
			return builder;
		},
	};
	callback(builder);
	if (!fields.length || new Set(fields.map((field) => field.name)).size !== fields.length) {
		throw new QueryError("orderBy must name distinct fields");
	}
	return fields;
}

/** @param {((builder: import("./types.js").WhereBuilder) => import("./types.js").WhereNode) | undefined} callback @returns {import("./types.js").WhereNode | null} */
function compileWhere(callback) {
	if (callback === undefined) {
		return null;
	}
	if (typeof callback !== "function") {
		throw new QueryError("where must be a callback");
	}
	const ast = callback(whereBuilder());
	/** @param {any} node */
	function check(node) {
		if (!node || typeof node !== "object" || typeof node.op !== "string") {
			throw new QueryError("where must return a builder expression");
		}
		if (node.op === "and" || node.op === "or") {
			if (!Array.isArray(node.conditions) || !node.conditions.length) {
				throw new QueryError(`${node.op} needs conditions`);
			}
			node.conditions.forEach(check);
		} else if (node.op === "not") {
			check(node.condition);
		} else if (
			!["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "startsWith", "exists"].includes(
				node.op,
			)
		) {
			throw new QueryError(`Unknown where operator ${node.op}`);
		}
		if (node.op === "in" && !Array.isArray(node.value)) {
			throw new QueryError("in requires an array");
		}
	}
	check(ast);
	return ast;
}

/** @param {unknown} a @param {unknown} b */
function same(a, b) {
	return stable(a) === stable(b);
}
/** @param {unknown} a @param {unknown} b */
function compare(a, b) {
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() - b.getTime();
	}
	if (typeof a === "string" && typeof b === "string") {
		if (a < b) {
			return -1;
		}
		if (a > b) {
			return 1;
		}
		return 0;
	}
	if (typeof a === "number" && typeof b === "number") {
		if (a < b) {
			return -1;
		}
		if (a > b) {
			return 1;
		}
		return 0;
	}
	if (typeof a === "bigint" && typeof b === "bigint") {
		if (a < b) {
			return -1;
		}
		if (a > b) {
			return 1;
		}
		return 0;
	}
	if (a instanceof Uint8Array && b instanceof Uint8Array) {
		return Buffer.compare(a, b);
	}
	return null;
}

/** @param {import("./types.js").WhereNode | null} node @param {import("./types.js").Document} doc @returns {boolean} */
function matches(node, doc) {
	if (!node) {
		return true;
	}
	if (node.op === "and") {
		return node.conditions.every((child) => matches(child, doc));
	}
	if (node.op === "or") {
		return node.conditions.some((child) => matches(child, doc));
	}
	if (node.op === "not") {
		return !matches(node.condition, doc);
	}
	const value = getPath(doc, node.path);
	switch (node.op) {
		case "eq":
			return same(value, node.value);
		case "ne":
			return !same(value, node.value);
		case "gt": {
			const result = compare(value, node.value);
			return result !== null && result > 0;
		}
		case "gte": {
			const result = compare(value, node.value);
			return result !== null && result >= 0;
		}
		case "lt": {
			const result = compare(value, node.value);
			return result !== null && result < 0;
		}
		case "lte": {
			const result = compare(value, node.value);
			return result !== null && result <= 0;
		}
		case "in":
			return Array.isArray(node.value) && node.value.some((item) => same(value, item));
		case "contains":
			if (typeof value === "string" && typeof node.value === "string") {
				return value.includes(node.value);
			}
			return Array.isArray(value) && value.some((item) => same(item, node.value));
		case "startsWith":
			return (
				typeof value === "string" && typeof node.value === "string" && value.startsWith(node.value)
			);
		case "exists":
			return (value !== undefined) === node.value;
		default:
			return false;
	}
}

/** @param {import("./types.js").Document} doc @param {string[] | undefined} fields @returns {import("./types.js").Document} */
function select(doc, fields) {
	if (!fields) {
		return doc;
	}
	/** @type {import("./types.js").Document} */
	const selected = { id: doc.id };
	for (const path of fields) {
		const value = getPath(doc, path);
		if (value === undefined) {
			continue;
		}
		const names = path.split(".");
		/** @type {Record<string, any>} */
		let target = selected;
		for (let i = 0; i < names.length - 1; i++) {
			target = target[names[i]] ??= {};
		}
		target[names[names.length - 1]] = value;
	}
	return selected;
}

/** @param {import("./types.js").WhereNode | null} node @returns {import("./types.js").Predicate | null} */
function firstEquality(node) {
	if (!node) {
		return null;
	}
	if (node.op === "eq") {
		return node;
	}
	if (node.op === "and") {
		return node.conditions.map(firstEquality).find(Boolean) ?? null;
	}
	return null;
}

/** @param {import("./types.js").WhereNode | null} node @param {string} path @returns {import("./types.js").Predicate | null} */
function equalityFor(node, path) {
	if (!node) {
		return null;
	}
	if (node.op === "eq" && node.path === path) {
		return node;
	}
	if (node.op === "and") {
		return node.conditions.map((child) => equalityFor(child, path)).find(Boolean) ?? null;
	}
	return null;
}

/** @param {string} id @param {Buffer} last @param {string} fingerprint */
function makeCursor(id, last, fingerprint) {
	return Buffer.from(JSON.stringify({ id, last: last.toString("base64"), fingerprint })).toString(
		"base64url",
	);
}

/** @param {string} token @returns {import("./types.js").Cursor} */
function readCursor(token) {
	try {
		const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			typeof value.id !== "string" ||
			typeof value.last !== "string" ||
			typeof value.fingerprint !== "string"
		) {
			throw new Error();
		}
		return { ...value, last: Buffer.from(value.last, "base64") };
	} catch {
		throw new CursorError("Invalid cursor");
	}
}

export class Query {
	/** @param {import("./collection.js").Collection} collection @param {import("./types.js").QueryOptions} options */
	constructor(collection, options) {
		if (!options || typeof options !== "object" || Array.isArray(options)) {
			throw new QueryError("filter options must be an object");
		}
		this.collection = collection;
		this.ast = compileWhere(options.where);
		this.order = compileOrder(options.orderBy);
		this.select = options.select;
		if (
			this.select !== undefined &&
			(!Array.isArray(this.select) || !this.select.every((path) => typeof path === "string"))
		) {
			throw new QueryError("select must be an array of field paths");
		}
		this.select?.forEach(checkPath);
		if (
			options.limit !== undefined &&
			(!Number.isSafeInteger(options.limit) || options.limit < 1)
		) {
			throw new QueryError("limit must be a positive integer");
		}
		this.limit = options.limit;
		this.cursor = options.cursor;
		if (this.cursor !== undefined && typeof this.cursor !== "string") {
			throw new CursorError("cursor must be a string");
		}
		this.fingerprint = createHash("sha256")
			.update(
				stable({
					table: collection.table.name,
					ast: this.ast,
					order: this.order,
					select: this.select ?? null,
				}),
			)
			.digest("hex");
		this.plan = this._plan();
		this.sessionId = null;
	}

	_plan() {
		const table = this.collection.table;
		if (this.order.length) {
			if (
				this.order.length === 1 &&
				this.order[0].name === "id" &&
				this.order[0].direction === "asc"
			) {
				return { prefix: docPrefix(table.name), index: null };
			}
			const index = table.indexes.find((candidate) =>
				indexMethod(candidate.method).supportsOrder(candidate, this.order),
			);
			if (!index) {
				throw new QueryError("orderBy requires a matching schema index");
			}
			return { prefix: indexPrefix(table.name, index.name), index };
		}
		const idEquality = equalityFor(this.ast, "id");
		if (
			idEquality &&
			(typeof idEquality.value === "string" || typeof idEquality.value === "number")
		) {
			return { key: docKey(table.name, idEquality.value), index: null };
		}
		const equality = firstEquality(this.ast);
		if (equality) {
			for (const index of table.indexes) {
				const prefix = indexMethod(index.method).equalityPrefix(
					table.name,
					index,
					equality.path,
					equality.value,
				);
				if (prefix) {
					return { prefix, index };
				}
			}
		}
		return { prefix: docPrefix(table.name), index: null };
	}

	/** @param {import("./types.js").Reader} reader @param {Uint8Array} [after] */
	async *_rows(reader, after) {
		if (this.plan.key) {
			if (after) {
				return;
			}
			const bytes = await reader.get(this.plan.key);
			if (bytes) {
				const doc = decodeData(bytes);
				if (matches(this.ast, doc)) {
					yield { key: this.plan.key, value: select(doc, this.select) };
				}
			}
			return;
		}
		for await (const row of scan(reader, this.plan.prefix, after)) {
			let bytes;
			if (this.plan.index) {
				bytes = await reader.get(row.value);
			} else {
				bytes = row.value;
			}
			if (!bytes) {
				continue;
			}
			const doc = decodeData(bytes);
			if (matches(this.ast, doc)) {
				yield { key: row.key, value: select(doc, this.select) };
			}
		}
	}

	async page() {
		if (this.collection.transaction) {
			throw new QueryError("page() is unavailable inside a transaction; use async iteration");
		}
		const db = this.collection.db;
		const pageSize = this.limit ?? 100;
		let id, session, after;
		if (this.cursor) {
			const cursor = readCursor(this.cursor);
			if (cursor.fingerprint !== this.fingerprint) {
				throw new CursorError("Cursor belongs to a different query");
			}
			id = cursor.id;
			after = cursor.last;
			session = db._getSession(id, this.fingerprint);
		} else {
			({ id, session } = await db._newSession(this.fingerprint));
		}
		this.sessionId = id;
		db._holdSession(session);
		const items = [];
		let last;
		let more = false;
		try {
			for await (const row of this._rows(session.snapshot, after)) {
				if (items.length === pageSize) {
					more = true;
					break;
				}
				items.push(row.value);
				last = row.key;
			}
			if (!more) {
				db._releaseSession(id);
				this.sessionId = null;
			}
			let nextCursor = null;
			if (more && last) {
				nextCursor = makeCursor(id, last, this.fingerprint);
			}
			return { items, nextCursor };
		} catch (error) {
			db._releaseSession(id);
			this.sessionId = null;
			throw error;
		} finally {
			db._idleSession(id);
		}
	}

	async *[Symbol.asyncIterator]() {
		const db = this.collection.db;
		await db._ready();
		if (!db.native) {
			throw new QueryError("Database is not open");
		}
		let reader,
			id = null,
			after;
		if (this.cursor) {
			if (this.collection.transaction) {
				throw new QueryError("Cursors are unavailable inside a transaction");
			}
			const cursor = readCursor(this.cursor);
			if (cursor.fingerprint !== this.fingerprint) {
				throw new CursorError("Cursor belongs to a different query");
			}
			id = cursor.id;
			after = cursor.last;
			const session = db._getSession(id, this.fingerprint);
			db._holdSession(session);
			reader = session.snapshot;
		} else {
			reader = this.collection.transaction ?? (await db.native.snapshot());
		}
		try {
			let count = 0;
			for await (const row of this._rows(reader, after)) {
				yield row.value;
				if (++count === this.limit) {
					return;
				}
			}
		} finally {
			if (id) {
				db._releaseSession(id);
			} else if (!this.collection.transaction) {
				reader.dispose();
			}
		}
	}

	close() {
		if (this.sessionId) {
			this.collection.db._releaseSession(this.sessionId);
		}
		this.sessionId = null;
	}
}
