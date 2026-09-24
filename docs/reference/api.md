# API reference

This page describes the API available from `sorodb`. Import the default or named `SoroDB` factory. The package also exports the error classes listed below.

```js
import SoroDB, { ConflictError, CursorError } from "sorodb";
```

All database and collection operations that access storage are asynchronous. Call `db.close()` when finished.

## Database

### `SoroDB(config)`

Creates a database object. `config` requires a `store` URL string and a nonempty `path` string. Tested store forms are `memory:///` and a filesystem URL such as one produced by `pathToFileURL(directory).href`. For a file URL, SoroDB joins the URL's directory with `path`. Optional `cursorTtlMs` is a positive integer; its default is five minutes.

### `db.schema({ version }, definitions)`

Registers the schema and returns `db` for chaining. `version` is an integer of at least 1. `definitions` is a nonempty array of table definitions. Register it before opening the database. The database opens when a collection or transaction first needs storage. See [schema and query reference](schema-and-query.md) and [schema upgrades](../guides/schema-upgrades.md).

### `await db.collection(name)`

Returns a collection registered in the schema. Unknown collection names raise `SchemaError`.

### `await db.transaction(async (tx) => { ... })`

Runs the callback in a transaction. Obtain transaction-bound collections with `await tx.collection(name)`. The transaction commits after the callback resolves and rolls back if it throws. Use `await` for operations inside the callback. See [transactions](../guides/transactions.md).

### `await db.close()`

Closes the database and releases active cursor snapshots. Calling it again is safe. A closed database cannot be reopened; construct a new SoroDB object to reopen the same store.

## Collection

Get a collection with `await db.collection(name)` or, inside a transaction, `await tx.collection(name)`.

| Method                                   | Result                                         | Behavior                                                                            |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `await collection.create(document)`      | Validated document, including applied defaults | Requires a unique `id`; duplicate IDs or unique index values raise `ConflictError`. |
| `await collection.get(id)`               | Document or `null`                             | Reads by string or number ID.                                                       |
| `await collection.replace(id, document)` | Validated replacement                          | Requires an existing document and the same `id`; replaces the whole document.       |
| `await collection.delete(id)`            | `true` or `false`                              | Returns `false` when no document had that ID.                                       |
| `collection.filter(options?)`            | Query object                                   | Builds a query without reading storage yet.                                         |

Writes validate against the table schema. Extra fields are rejected. Values must be CBOR-compatible plain data: null, booleans, finite numbers, strings, BigInts, Dates, byte arrays, arrays, and plain objects. Cycles, sparse arrays, invalid Dates, and unsupported object types raise `ValidationError`. See [schema and query reference](schema-and-query.md).

## Query

`collection.filter(options)` accepts the following optional fields:

| Option                                                 | Meaning                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `where: (w) => expression`                             | Filter expression built with the operators in the [query reference](schema-and-query.md#filters).            |
| `orderBy: (order) => order.asc(path)` or `.desc(path)` | Sort by one or more fields. Chaining calls adds fields. Requires a matching index except for ascending `id`. |
| `select: [path, ...]`                                  | Project fields; `id` is always present. Paths may be dotted.                                                 |
| `limit: positiveInteger`                               | Maximum items from an iterator, or page size for `page()`.                                                   |
| `cursor: string`                                       | Continue a previous page or iteration from a matching query snapshot.                                        |

### `await query.page()`

Returns `{ items, nextCursor }`, where `nextCursor` is a string if another page exists and `null` otherwise. The default page size is 100. Reuse the same filter, order, and projection with the returned cursor. The cursor is tied to an in-memory snapshot on the same open database object, so it cannot survive `db.close()` or expiration. `page()` is unavailable inside a transaction. See [pagination](../guides/pagination.md).

### `for await (const document of query)`

Iterates matching documents. A `limit` applies if provided; otherwise iteration continues through the matching results. Async iteration works with transaction-bound collections. Complete or break out of the loop to release its snapshot.

### `query.close()`

Releases a snapshot retained by a `page()` query when abandoning its next cursor. The cursor then cannot be resumed.

## Errors

All exported errors extend `SoroError` and have a `code` string. Some include `details`.

| Export            | Code               | Typical cause                                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `ValidationError` | `VALIDATION_ERROR` | Document violates its schema or contains unsupported values.                         |
| `SchemaError`     | `SCHEMA_ERROR`     | Invalid schema, incompatible version, unknown collection, or invalid database state. |
| `ConflictError`   | `CONFLICT`         | Duplicate ID, unique index collision, or missing replacement target.                 |
| `QueryError`      | `QUERY_ERROR`      | Invalid filter or sort, or unsupported query operation.                              |
| `CursorError`     | `CURSOR_ERROR`     | Invalid, expired, or mismatched cursor.                                              |

```js
try {
	await users.create({ id: 1, name: "Ada" });
} catch (error) {
	if (error instanceof ConflictError) console.error(error.code, error.message);
	else throw error;
}
```
