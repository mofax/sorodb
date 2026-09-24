# Architecture

This page maps the implementation for contributors. The [API reference](../reference/api.md) describes the supported public behavior.

## Module map

| Module                                                                                         | Responsibility                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`src/index.js`](../../src/index.js)                                                           | Public factory and error exports.                                      |
| [`src/storage.js`](../../src/storage.js)                                                       | SlateDB lifecycle, transactions, schema upgrades, and cursor sessions. |
| [`src/schema.js`](../../src/schema.js)                                                         | ArkType compilation, document validation, and safe schema comparisons. |
| [`src/collection.js`](../../src/collection.js)                                                 | CRUD operations and index maintenance around writes.                   |
| [`src/query.js`](../../src/query.js)                                                           | Filter expressions, query planning, projection, iteration, and pages.  |
| [`src/index-methods.js`](../../src/index-methods.js), [`src/indexes.js`](../../src/indexes.js) | B-tree key encoding, uniqueness checks, and index entry changes.       |
| [`src/encoding.js`](../../src/encoding.js)                                                     | CBOR values, document keys, key ranges, and stable value encoding.     |
| [`src/errors.js`](../../src/errors.js), [`src/types.js`](../../src/types.js)                   | Error classes and JSDoc type definitions.                              |

## Storage and writes

`SoroDB(config)` constructs a `Database` without opening SlateDB. `schema()` compiles and stores the requested definition in memory. The first collection or transaction operation opens the native store and compares the persisted schema with that definition. The database uses distinct key prefixes for schema metadata, documents, and index entries.

Document values are CBOR-encoded. An index entry's key contains the indexed values, and its value points to the document key. CRUD writes update both in one serializable snapshot transaction. Unique indexes check for an existing pointer before writing. A failed write rolls back the transaction, so its document and index entries are not partially committed.

## Schema upgrades

`schemaDiff` compares the stored and requested definitions. For a higher version, it permits additions and rejects changes or removals to existing definitions. `_migrate` validates old documents with the new table definition, applies defaults, rebuilds newly added indexes, and writes the new schema metadata after backfill succeeds. The index rebuild path is designed to allow retrying an interrupted or failed addition. The repository's `test/sorodb.test.js` exercises successful backfill and a failed unique-index addition.

## Reads and cursors

`Query` compiles filter and order options when `filter()` is called. Its planner uses a direct document lookup for suitable `id` equality, an index scan for matching sort order or eligible equality, and otherwise a document scan. Every candidate is checked against the full filter expression before projection.

Async iteration reads from a snapshot, or from the active transaction when used there. `page()` retains a snapshot in a database-local cursor session so later pages see the same data even if writes occur. The cursor token carries a session ID, last key, and query fingerprint. Sessions expire after inactivity and are released on completion, explicit `Query.close()`, or `Database.close()`.

When changing public behavior, update the matching [reference page](../reference/api.md), task guide, and behavioral test together.
