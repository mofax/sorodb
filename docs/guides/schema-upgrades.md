# Upgrade a persistent schema

SoroDB stores the schema version and definition with the database. Register the same version and definition to reopen it unchanged. Increase the version when changing the definition; changing a stored definition without increasing the version raises `SchemaError`.

An upgrade can add tables, columns, or indexes. Removing or changing an existing table, column, or index is rejected as unsafe. SoroDB validates existing documents when it backfills newly added columns and builds newly added indexes.

## Add a column with a default and an index

This complete example creates version 1 in a temporary directory, then reopens it with an added `createdAt` column and index:

```js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import SoroDB from "sorodb";

const directory = await mkdtemp(join(tmpdir(), "sorodb-upgrade-"));
const config = { store: pathToFileURL(directory).href, path: "data" };
try {
	const first = SoroDB(config).schema({ version: 1 }, [
		{
			table: "items",
			columns: {
				id: { type: "number", primary: true },
				label: { type: "string" },
			},
		},
	]);
	try {
		await (await first.collection("items")).create({ id: 1, label: "one" });
	} finally {
		await first.close();
	}

	const second = SoroDB(config).schema({ version: 2 }, [
		{
			table: "items",
			columns: {
				id: { type: "number", primary: true },
				label: { type: "string" },
				createdAt: { type: "date", default: () => new Date("2026-01-01") },
			},
			indexes: [{ name: "created_at", columns: ["createdAt"] }],
		},
	]);
	try {
		const items = await second.collection("items"); // opens and upgrades
		console.log(await items.get(1));
	} finally {
		await second.close();
	}
} finally {
	await rm(directory, { recursive: true, force: true });
}
```

Supply a default for a new required field if existing documents need a value. An optional field can be added without a default. If backfill validation fails or a new unique index finds duplicates, opening fails; correct the stored data under the previous schema, close it, and retry the upgrade.

## Before an upgrade

1. Keep the full existing table and index definitions in the new schema.
2. Increase `version` and add only the new definitions.
3. Check that defaults produce valid values for old documents and that unique index values have no duplicates.
4. Back up the database directory before upgrading production data, then open with the new schema and verify representative reads and queries.

The repository's `test/sorodb.test.js` covers a successful upgrade and a failed unique-index backfill followed by a retry.
