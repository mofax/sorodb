# Schema and query reference

Register a schema with `db.schema({ version }, definitions)` before using a collection. The version must be an integer of at least 1, and `definitions` must contain at least one table.

## Table definitions

```js
db.schema({ version: 1 }, [
	{
		table: "users",
		columns: {
			id: { type: "number", primary: true },
			name: { type: "string" },
			nickname: { type: "string?" },
			joinedAt: { type: "date", default: () => new Date() },
		},
		indexes: [{ name: "joined_at", columns: [{ field: "joinedAt", direction: "desc" }] }],
	},
]);
```

Each table needs a unique name and a `columns` object. Table, column, and index names must start with a letter and contain only letters, digits, or underscores. Exactly one column must be marked `primary: true`, and it must be named `id`. Its type must be a required string or number type; stored IDs must be strings or finite numbers.

Each column has a `type` containing an [ArkType definition](https://arktype.io/docs/intro). Common strings include `"string"`, `"number"`, `"string[]"`, `"bigint"`, and `"unknown"`. SoroDB also accepts `"date"` for a `Date`, `"string?"` for an optional string, and expressions such as `"string | null"` for nullable values. You can pass an ArkType type object where a string definition is insufficient.

`default` can be a value or a zero-argument function. SoroDB applies it when a field is `undefined` on create or replace, then validates the result. Value defaults are cloned for each document; function defaults are called for each document. Fields without optional types or defaults must be supplied. Undeclared fields are rejected.

Documents are stored as CBOR. Supported data includes null, booleans, finite numbers, strings, BigInts, valid Dates, `Uint8Array` values, dense arrays, and plain objects containing these values. Sparse arrays, cycles, invalid Dates, and unsupported class instances cannot be stored. `Date`, BigInt, and byte array values round-trip through storage.

For persistent data, [schema upgrades](../guides/schema-upgrades.md) explains version changes and backfilling.

## Index definitions

An index has a unique `name`, a nonempty `columns` array, optional `unique: true`, and optional `method: "btree"`. `btree` is the only current method and is the default. Each column is a field name or `{ field, direction }`; direction defaults to `"asc"` and can be `"desc"`. Dotted paths can point into nested document data, provided the top-level column is declared.

```js
indexes: [
	{ name: "email", columns: ["email"], unique: true },
	{
		name: "recent_by_team",
		columns: ["team", { field: "joinedAt", direction: "desc" }],
	},
];
```

B-tree fields support missing values, null, booleans, finite numbers, BigInts, strings, valid Dates, and byte arrays. Indexing an array or object value fails validation on write. A unique index skips a document when an indexed field is missing; `null` is an indexed value and must be unique when `unique: true`.

## Filters

Pass `where` to `collection.filter`. It receives a builder and must return one expression. Paths may be dotted, such as `"profile.city"`.

```js
const query = users.filter({
	where: (w) => w.and(w.gte("age", 18), w.startsWith("name", "A")),
});
```

| Builder                                                        | Matches                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `eq(path, value)`, `ne(path, value)`                           | Equal or unequal values.                                                                 |
| `gt`, `gte`, `lt`, `lte`                                       | Ordered comparisons between compatible numbers, strings, BigInts, Dates, or byte arrays. |
| `in(path, values)`                                             | A field equal to any value in an array.                                                  |
| `contains(path, value)`                                        | A substring in a string, or an equal element in an array.                                |
| `startsWith(path, prefix)`                                     | A string with the given prefix.                                                          |
| `exists(path, present?)`                                       | Field is defined; pass `false` to match missing fields. `null` counts as present.        |
| `and(...expressions)`, `or(...expressions)`, `not(expression)` | Combine filter expressions.                                                              |

Filter results are checked against complete documents, even when an index is used to find candidates. Equality on `id` can use the primary key directly. An equality filter may use a B-tree index when its first field matches the filter path and is ascending; other filters can scan documents. See [indexes and sorting](../guides/indexes-and-sorting.md).

## Ordering, projection, and limits

This example assumes `users` has a `team` column and the `recent_by_team` index shown above.

```js
const page = await users
	.filter({
		where: (w) => w.eq("team", "platform"),
		orderBy: (order) => order.asc("team").desc("joinedAt"),
		select: ["name", "joinedAt"],
		limit: 20,
	})
	.page();
```

`orderBy` requires an index whose leading fields and directions match the requested order. Ascending `id` works without a declared index. Fields in one order must be distinct. Without `orderBy`, do not rely on a particular result order.

`select` accepts field paths and always retains `id`. Missing selected fields are omitted. `limit` must be a positive integer. It caps async iteration and sets the size of a page; `page()` defaults to 100. See [pagination](../guides/pagination.md) for cursors and snapshot behavior.
