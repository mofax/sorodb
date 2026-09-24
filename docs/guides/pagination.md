# Read stable pages

Call `page()` on a filtered collection. It returns `items` and a `nextCursor`, which is `null` after the final page. The default page size is 100; set a positive `limit` for another size.

```js
import SoroDB from "sorodb";

const db = SoroDB({ store: "memory:///", path: "pagination-guide" });
db.schema({ version: 1 }, [
	{
		table: "users",
		columns: {
			id: { type: "number", primary: true },
			team: { type: "string" },
		},
	},
]);

try {
	const users = await db.collection("users");
	for (let id = 1; id <= 3; id++) await users.create({ id, team: "platform" });

	const options = {
		where: (w) => w.eq("team", "platform"),
		orderBy: (order) => order.asc("id"),
		limit: 2,
	};
	let cursor;
	do {
		const page = await users.filter({ ...options, cursor }).page();
		for (const user of page.items) console.log(user);
		cursor = page.nextCursor ?? undefined;
	} while (cursor);

	const abandoned = users.filter({ limit: 1 });
	const first = await abandoned.page();
	if (first.nextCursor) abandoned.close();
} finally {
	await db.close();
}
```

Pages in one cursor chain read from the same snapshot, so intervening writes do not change the remaining pages. To continue, use the same table, filter, order, and projection. The page size can change. A cursor belongs to the same open database object and expires after inactivity; `cursorTtlMs` sets that interval and defaults to five minutes. A mismatched, invalid, expired, or closed cursor raises `CursorError`.

If you abandon a page chain, keep a reference to its query and call `query.close()` to release its snapshot promptly, as the example does with `abandoned`.

`page()` cannot run inside a transaction. Async iteration is useful when you want to consume results in one pass, including within a transaction. A cursor is an opaque token; store or transmit it unchanged, and do not expect it to work after the database closes.
