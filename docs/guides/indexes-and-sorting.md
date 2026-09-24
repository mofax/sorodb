# Add indexes for queries and sorting

Declare indexes in the table schema. They are maintained when documents are created, replaced, or deleted. The current index method is `btree`.

## Sort by an indexed field

```js
import SoroDB, { ConflictError } from "sorodb";

const db = SoroDB({ store: "memory:///", path: "index-guide" });
db.schema({ version: 1 }, [
	{
		table: "users",
		columns: {
			id: { type: "number", primary: true },
			name: { type: "string" },
			email: { type: "string" },
			joinedAt: { type: "date" },
		},
		indexes: [
			{ name: "recent_users", columns: [{ field: "joinedAt", direction: "desc" }] },
			{ name: "email_unique", columns: ["email"], unique: true },
		],
	},
]);

try {
	const users = await db.collection("users");
	await users.create({
		id: 1,
		name: "Ada",
		email: "ada@example.com",
		joinedAt: new Date("2026-01-01"),
	});
	await users.create({
		id: 2,
		name: "Grace",
		email: "grace@example.com",
		joinedAt: new Date("2026-02-01"),
	});
	const newest = await users.filter({ orderBy: (order) => order.desc("joinedAt") }).page();
	console.log(newest.items.map((user) => user.name)); // ["Grace", "Ada"]

	try {
		await users.create({
			id: 3,
			name: "Another Ada",
			email: "ada@example.com",
			joinedAt: new Date(),
		});
	} catch (error) {
		if (!(error instanceof ConflictError)) throw error;
		console.log(error.code); // CONFLICT
	}
} finally {
	await db.close();
}
```

The requested order must match the leading fields and directions of one declared index. For example, an index on `(team asc, joinedAt desc)` supports `order.asc("team")` and `order.asc("team").desc("joinedAt")`. It does not support sorting only by `joinedAt`. Ascending `id` is the one order that needs no declared index. An unsupported order raises `QueryError` when `filter()` builds the query.

## Enforce uniqueness

The `email_unique` index in the example raises `ConflictError` for a duplicate value. Creating or replacing a document with another document's indexed value has the same result. A document missing an indexed field is omitted from that unique index; `null` is indexed and therefore subject to the constraint.

## Equality lookups

An equality filter on `id` uses the document key. Other equality filters may use an index if its first field is the filtered path, the field is ascending, and the value is indexable. All returned candidates are still checked against the entire filter expression. Other predicates may require a scan, so choose indexes for the filters and orderings that matter to your workload.

For index syntax and supported values, see the [schema and query reference](../reference/schema-and-query.md#index-definitions).
