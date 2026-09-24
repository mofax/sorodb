# Getting started

This tutorial creates a file-backed SoroDB database, writes documents, queries them, and reopens the data. You need Node.js 20 or later. Run `bun install --frozen-lockfile` in this checkout and save `app.mjs` at the repository root. Once SoroDB is published to npm, you can instead install it in another ESM project with `npm install sorodb`.

## 1. Create a store and schema

Save the following as `app.mjs`:

```js
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import SoroDB from "sorodb";

const directory = resolve("./sorodb-data");
await mkdir(directory, { recursive: true });
const config = { store: pathToFileURL(directory).href, path: "app" };

function openDatabase() {
	return SoroDB(config).schema({ version: 1 }, [
		{
			table: "users",
			columns: {
				id: { type: "number", primary: true },
				name: { type: "string" },
				joinedAt: { type: "date", default: () => new Date() },
			},
			indexes: [{ name: "joined_at", columns: [{ field: "joinedAt", direction: "desc" }] }],
		},
	]);
}

const db = openDatabase();
try {
	const users = await db.collection("users");
	await users.create({ id: 1, name: "Ada" });
	await users.create({ id: 2, name: "Grace" });

	for await (const user of users.filter({ orderBy: (order) => order.desc("joinedAt") })) {
		console.log(user.name, user.joinedAt);
	}
} finally {
	await db.close();
}
```

Run `node app.mjs`. The `store` URL identifies the filesystem directory; `path` names the SlateDB database within it. The first operation that needs storage opens the database. `close()` releases it.

## 2. Reopen and read

Replace the write block inside `try` with this block, then run `node app.mjs` again:

```js
const users = await db.collection("users");
console.log(await users.get(1));
console.log((await users.filter({ where: (w) => w.eq("name", "Grace") }).page()).items);
```

The first result is Ada's document, including a `Date` in `joinedAt`. The second result contains Grace's document. Keep the same schema version and definition when reopening existing data.

## Next steps

- [Schema and query reference](reference/schema-and-query.md) lists the supported definitions and operators.
- [Indexes and sorting](guides/indexes-and-sorting.md) explains the index required by `orderBy`.
- [Schema upgrades](guides/schema-upgrades.md) shows how to evolve a persistent schema.
- [API reference](reference/api.md) covers CRUD, transactions, and query results.

For a disposable database, use `{ store: "memory:///", path: "example" }` instead of a file URL. See [`examples/basic.js`](../examples/basic.js) for a complete in-memory example.
