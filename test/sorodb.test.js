// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { type } from "arktype";
import { decode } from "cbor2";
import { docKey, encodeData } from "../src/encoding.js";
import { indexKey } from "../src/index-methods.js";
import SoroDB, {
	ConflictError,
	CursorError,
	QueryError,
	SchemaError,
	ValidationError,
} from "../src/index.js";

let nextPath = 0;
/** @param {import("../src/types.js").TableDefinition[]} definitions */
const memory = (definitions) => {
	const db = SoroDB({ store: "memory:///", path: `sorodb-test-${++nextPath}` });
	db.schema({ version: 1 }, definitions);
	return db;
};
/** @type {import("../src/types.js").TableDefinition} */
const usersDefinition = {
	table: "users",
	columns: {
		id: { type: "number", primary: true },
		name: { type: "string" },
		email: { type: "string" },
		age: { type: "number" },
		tags: { type: "string[]" },
		createdAt: { type: "date", default: () => new Date("2026-01-01T00:00:00.000Z") },
	},
	indexes: [
		{ name: "email_index", columns: ["email"], unique: true },
		{ name: "created_index", columns: [{ field: "createdAt", direction: "desc" }] },
	],
};

test("schema defaults, Date round trips, CRUD, and validation", async () => {
	const db = memory([usersDefinition]);
	try {
		const users = await db.collection("users");
		const alice = await users.create({
			id: 1,
			name: "Alice",
			email: "a@example.com",
			age: 31,
			tags: ["staff"],
		});
		assert.ok(alice.createdAt instanceof Date);
		assert.deepEqual(await users.get(1), alice);
		await assert.rejects(
			users.create({ id: 2, name: "Bad", email: "b@example.com", age: 1, tags: [], extra: true }),
			ValidationError,
		);
		await assert.rejects(
			users.create({ id: 2, name: "Bad", email: "b@example.com", age: "old", tags: [] }),
			ValidationError,
		);
		await assert.rejects(users.create({ ...alice }), ConflictError);
		await assert.rejects(
			users.create({ id: 2, name: "A2", email: alice.email, age: 2, tags: [] }),
			ConflictError,
		);
		const replaced = await users.replace(1, {
			...alice,
			name: "Alice Smith",
			email: "new@example.com",
		});
		assert.equal(replaced.name, "Alice Smith");
		assert.equal((await users.get(1)).email, "new@example.com");
		assert.equal(await users.delete(1), true);
		assert.equal(await users.delete(1), false);
		assert.equal(await users.get(1), null);
	} finally {
		await db.close();
	}
});

test("query builders, projection, indexed sorting, and async iteration", async () => {
	const db = memory([usersDefinition]);
	try {
		const users = await db.collection("users");
		const rows = [
			{
				id: 1,
				name: "Alice",
				email: "a@x.com",
				age: 31,
				tags: ["staff"],
				createdAt: new Date("2026-01-01"),
			},
			{
				id: 2,
				name: "Bob",
				email: "b@x.com",
				age: 20,
				tags: ["guest"],
				createdAt: new Date("2026-01-03"),
			},
			{
				id: 3,
				name: "Aria",
				email: "c@x.com",
				age: 25,
				tags: ["staff"],
				createdAt: new Date("2026-01-02"),
			},
		];
		for (const row of rows) {
			await users.create(row);
		}
		const query = users.filter({
			where: (w) =>
				w.and(w.gte("age", 25), w.or(w.startsWith("name", "A"), w.contains("tags", "guest"))),
			orderBy: (o) => o.desc("createdAt"),
			select: ["name"],
			limit: 10,
		});
		const result = [];
		for await (const row of query) {
			result.push(row);
		}
		assert.deepEqual(result, [
			{ id: 3, name: "Aria" },
			{ id: 1, name: "Alice" },
		]);
		assert.deepEqual(
			(await users.filter({ where: (w) => w.eq("email", "b@x.com") }).page()).items.map(
				(x) => x.id,
			),
			[2],
		);
		assert.deepEqual(
			(await users.filter({ where: (w) => w.in("id", [1, 3]) }).page()).items.map((x) => x.id),
			[1, 3],
		);
		assert.deepEqual(
			(await users.filter({ where: (w) => w.not(w.exists("missing")) }).page()).items.map(
				(x) => x.id,
			),
			[1, 2, 3],
		);
		assert.deepEqual(
			(await users.filter({ orderBy: (o) => o.asc("id") }).page()).items.map((x) => x.id),
			[1, 2, 3],
		);
		/** @type {[import("../src/types.js").QueryOptions["where"], number[]][]} */
		const cases = [
			[(w) => w.ne("age", 20), [1, 3]],
			[(w) => w.gt("age", 25), [1]],
			[(w) => w.lt("age", 25), [2]],
			[(w) => w.lte("age", 25), [2, 3]],
			[(w) => w.contains("name", "li"), [1]],
			[(w) => w.exists("name"), [1, 2, 3]],
		];
		for (const [where, expected] of cases) {
			assert.deepEqual(
				(await users.filter({ where }).page()).items.map((x) => x.id),
				expected,
			);
		}
		assert.throws(() => users.filter({ orderBy: (o) => o.asc("age") }), QueryError);
	} finally {
		await db.close();
	}
});

test("optional and nullable ArkType definitions", async () => {
	const db = memory([
		{
			table: "records",
			columns: {
				id: { type: "string", primary: true },
				nickname: { type: "string?" },
				bio: { type: "string | null" },
				score: { type: type("number.integer >= 0") },
			},
			indexes: [{ name: "nickname_index", columns: ["nickname"] }],
		},
	]);
	try {
		const records = await db.collection("records");
		assert.deepEqual(await records.create({ id: "one", bio: null, score: 0 }), {
			id: "one",
			bio: null,
			score: 0,
		});
		await records.create({ id: "two", nickname: "Bee", bio: "hello", score: 1 });
		assert.deepEqual(
			(await records.filter({ orderBy: (o) => o.asc("nickname") }).page()).items.map((x) => x.id),
			["one", "two"],
		);
		await assert.rejects(records.create({ id: "three", bio: null, score: -1 }), ValidationError);
	} finally {
		await db.close();
	}
});

test("CBOR storage round trips nested core values and keeps index pointers raw", async () => {
	const db = memory([
		{
			table: "binary",
			columns: {
				id: { type: "string", primary: true },
				amount: { type: "bigint" },
				bytes: { type: type.instanceOf(Uint8Array) },
				createdAt: { type: "date" },
				metadata: { type: "unknown" },
			},
			indexes: [{ name: "amount_index", method: "btree", columns: ["amount"], unique: true }],
		},
	]);
	try {
		const records = await db.collection("binary");
		const document = {
			id: "one",
			amount: 2n ** 130n,
			bytes: new Uint8Array([0, 255, 1]),
			createdAt: new Date("2026-09-24T12:34:56.789Z"),
			metadata: {
				small: 1n,
				nested: [new Uint8Array([3, 4]), new Date("2026-01-01T00:00:00.123Z")],
			},
		};
		await records.create(document);
		assert.deepEqual(await records.get("one"), document);
		const native = db.native;
		const table = db.definition?.tables.get("binary");
		assert.ok(native && table);
		const raw = await native.get(docKey("binary", "one"));
		const schemaBytes = await native.get(Buffer.from("M\0schema"));
		assert.ok(raw && schemaBytes);
		assert.deepEqual(decode(new Uint8Array(raw), { collapseBigInts: false }), document);
		assert.equal(/** @type {any} */ (decode(schemaBytes)).version, 1);
		const indexBytes = indexKey("binary", table.indexes[0], document);
		assert.ok(indexBytes);
		const pointer = await native.get(indexBytes);
		assert.ok(pointer);
		assert.deepEqual(Buffer.from(pointer), docKey("binary", "one"));
		assert.deepEqual(
			(await records.filter({ where: (w) => w.eq("bytes", new Uint8Array([0, 255, 1])) }).page())
				.items,
			[document],
		);
		assert.deepEqual(
			(await records.filter({ where: (w) => w.eq("amount", 2n ** 130n) }).page()).items,
			[document],
		);
		await assert.rejects(records.create({ ...document, id: "two" }), ConflictError);
	} finally {
		await db.close();
	}
});

test("btree orders BigInts and bytes, and rejects unsupported indexed values", async () => {
	const db = memory([
		{
			table: "values",
			columns: {
				id: { type: "number", primary: true },
				amount: { type: "bigint" },
				bytes: { type: type.instanceOf(Uint8Array) },
			},
			indexes: [
				{ name: "amount_index", columns: ["amount"] },
				{
					name: "bytes_index",
					method: "btree",
					columns: [{ field: "bytes", direction: "desc" }],
					unique: true,
				},
			],
		},
	]);
	try {
		const values = await db.collection("values");
		const rows = [
			{ id: 1, amount: 0n, bytes: new Uint8Array([0]) },
			{ id: 2, amount: -(2n ** 130n), bytes: new Uint8Array([0, 1]) },
			{ id: 3, amount: 2n ** 130n, bytes: new Uint8Array([1]) },
			{ id: 4, amount: -1n, bytes: new Uint8Array([]) },
			{ id: 5, amount: 1n, bytes: new Uint8Array([0, 0]) },
		];
		for (const row of rows) {
			await values.create(row);
		}
		assert.deepEqual(
			(await values.filter({ orderBy: (o) => o.asc("amount") }).page()).items.map((x) => x.id),
			[2, 4, 1, 5, 3],
		);
		assert.deepEqual(
			(await values.filter({ orderBy: (o) => o.desc("bytes") }).page()).items.map((x) => x.id),
			[3, 2, 5, 1, 4],
		);
		assert.deepEqual(
			(await values.filter({ where: (w) => w.gt("amount", 0n) }).page()).items.map((x) => x.id),
			[3, 5],
		);
		assert.deepEqual(
			(
				await values.filter({ where: (w) => w.eq("bytes", new Uint8Array([0, 1])) }).page()
			).items.map((x) => x.id),
			[2],
		);
		await assert.rejects(
			values.create({ id: 6, amount: 9n, bytes: new Uint8Array([0, 1]) }),
			ConflictError,
		);
	} finally {
		await db.close();
	}
	const unsupported = memory([
		{
			table: "items",
			columns: { id: { type: "number", primary: true }, value: { type: "unknown" } },
			indexes: [{ name: "value_index", columns: ["value"] }],
		},
	]);
	try {
		const items = await unsupported.collection("items");
		await assert.rejects(items.create({ id: 1, value: [1, 2] }), ValidationError);
		assert.equal(await items.get(1), null);
	} finally {
		await unsupported.close();
	}
	assert.throws(() => encodeData({ value: Infinity }), ValidationError);
	assert.throws(() => encodeData({ value: new Date(NaN) }), ValidationError);
	assert.throws(() => encodeData({ value: new Map() }), ValidationError);
	const cyclic = {};
	cyclic.self = cyclic;
	assert.throws(() => encodeData(cyclic), ValidationError);
});

test("transaction commits across collections and rolls back on failure", async () => {
	const db = memory([
		usersDefinition,
		{
			table: "notes",
			columns: { id: { type: "string", primary: true }, text: { type: "string" } },
		},
	]);
	try {
		await db.transaction(async (tx) => {
			await (
				await tx.collection("users")
			).create({ id: 1, name: "Alice", email: "a@x.com", age: 31, tags: [] });
			await (await tx.collection("notes")).create({ id: "n1", text: "hello" });
		});
		assert.equal((await (await db.collection("notes")).get("n1")).text, "hello");
		await assert.rejects(
			db.transaction(async (tx) => {
				await (await tx.collection("notes")).create({ id: "n2", text: "rollback" });
				throw new Error("abort");
			}),
			/abort/,
		);
		assert.equal(await (await db.collection("notes")).get("n2"), null);
	} finally {
		await db.close();
	}
});

test("pagination keeps a stable snapshot while documents change", async () => {
	const db = memory([
		{
			table: "items",
			columns: { id: { type: "number", primary: true }, value: { type: "string" } },
		},
	]);
	try {
		const items = await db.collection("items");
		for (let id = 1; id <= 4; id++) {
			await items.create({ id, value: String(id) });
		}
		const first = await items.filter({ limit: 2 }).page();
		assert.deepEqual(
			first.items.map((item) => item.id),
			[1, 2],
		);
		assert.ok(first.nextCursor);
		await items.delete(3);
		await items.create({ id: 5, value: "5" });
		const second = await items.filter({ limit: 2, cursor: first.nextCursor }).page();
		assert.deepEqual(
			second.items.map((item) => item.id),
			[3, 4],
		);
		assert.equal(second.nextCursor, null);
	} finally {
		await db.close();
	}
});

test("idle cursor expires and cannot be resumed", async () => {
	const db = SoroDB({ store: "memory:///", path: `sorodb-test-${++nextPath}`, cursorTtlMs: 10 });
	db.schema({ version: 1 }, [
		{ table: "items", columns: { id: { type: "number", primary: true } } },
	]);
	try {
		const items = await db.collection("items");
		await items.create({ id: 1 });
		await items.create({ id: 2 });
		const first = await items.filter({ limit: 1 }).page();
		assert.ok(first.nextCursor);
		await delay(30);
		await assert.rejects(items.filter({ limit: 1, cursor: first.nextCursor }).page(), CursorError);
	} finally {
		await db.close();
	}
});

test("file persistence, safe backfill, and schema version checks", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sorodb-"));
	const config = { store: pathToFileURL(directory).href, path: "data" };
	const first = [
		{
			table: "items",
			columns: { id: { type: "number", primary: true }, label: { type: "string" } },
		},
	];
	const second = [
		{
			table: "items",
			columns: {
				id: { type: "number", primary: true },
				label: { type: "string" },
				createdAt: { type: "date", default: () => new Date("2026-02-01") },
				counter: { type: "bigint", default: 1n },
			},
			indexes: [{ name: "label_index", columns: ["label"] }],
		},
	];
	try {
		const db1 = SoroDB(config).schema({ version: 1 }, first);
		await (await db1.collection("items")).create({ id: 1, label: "one" });
		await db1.close();
		const db2 = SoroDB(config).schema({ version: 2 }, second);
		const items = await db2.collection("items");
		assert.ok((await items.get(1)).createdAt instanceof Date);
		assert.equal((await items.get(1)).counter, 1n);
		assert.deepEqual(
			(await items.filter({ orderBy: (o) => o.asc("label") }).page()).items.map((x) => x.id),
			[1],
		);
		await db2.close();
		const stale = SoroDB(config).schema({ version: 1 }, first);
		await assert.rejects(stale.collection("items"), SchemaError);
		await stale.close();
		const changed = SoroDB(config).schema({ version: 2 }, first);
		await assert.rejects(changed.collection("items"), SchemaError);
		await changed.close();
		const invalid = SoroDB(config).schema({ version: 3 }, [
			{
				table: "items",
				columns: {
					...second[0].columns,
					requiredNew: { type: "string" },
				},
				indexes: second[0].indexes,
			},
		]);
		await assert.rejects(invalid.collection("items"), ValidationError);
		await invalid.close();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("failed unique-index backfill can be repaired and retried", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sorodb-retry-"));
	const config = { store: pathToFileURL(directory).href, path: "data" };
	const initial = [
		{
			table: "items",
			columns: { id: { type: "number", primary: true }, email: { type: "string" } },
		},
	];
	const indexed = [
		{ ...initial[0], indexes: [{ name: "email_index", columns: ["email"], unique: true }] },
	];
	try {
		const db1 = SoroDB(config).schema({ version: 1 }, initial);
		const items = await db1.collection("items");
		await items.create({ id: 1, email: "same" });
		await items.create({ id: 2, email: "same" });
		await db1.close();
		const attempt = SoroDB(config).schema({ version: 2 }, indexed);
		await assert.rejects(attempt.collection("items"), ConflictError);
		await attempt.close();
		const repair = SoroDB(config).schema({ version: 1 }, initial);
		await (await repair.collection("items")).delete(2);
		await repair.close();
		const retry = SoroDB(config).schema({ version: 2 }, indexed);
		assert.equal((await (await retry.collection("items")).get(1)).email, "same");
		await retry.close();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
