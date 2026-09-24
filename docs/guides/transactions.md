# Write across collections in a transaction

Use `db.transaction()` when related operations must commit together. The callback receives a transaction object; obtain collections through `tx.collection()` so their reads and writes participate in the transaction.

```js
import SoroDB from "sorodb";

const db = SoroDB({ store: "memory:///", path: "transaction-guide" });
db.schema({ version: 1 }, [
	{ table: "users", columns: { id: { type: "number", primary: true }, name: { type: "string" } } },
	{ table: "notes", columns: { id: { type: "string", primary: true }, text: { type: "string" } } },
]);

try {
	await db.transaction(async (tx) => {
		const users = await tx.collection("users");
		const notes = await tx.collection("notes");

		await users.create({ id: 1, name: "Ada" });
		await notes.create({ id: "welcome", text: "Hello, Ada" });
	});

	await db.transaction(async (tx) => {
		const users = await tx.collection("users");
		for await (const user of users.filter({ where: (w) => w.eq("name", "Ada") })) {
			console.log(user);
		}
	});
} finally {
	await db.close();
}
```

The transaction commits when the callback resolves. If an operation or the callback throws, the transaction rolls back. Await each operation before the callback returns.

Collection `get`, `create`, `replace`, and `delete` work inside a transaction. Queries can use async iteration, as shown above.

`query.page()` and cursor-based iteration are unavailable on transaction-bound collections. For paginated reads, run `page()` outside the transaction; see [pagination](pagination.md).
