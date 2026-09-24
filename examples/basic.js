// @ts-check
import SoroDB from "../src/index.js";

const db = SoroDB({ store: "memory:///", path: "example" });
db.schema({ version: 1 }, [
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

try {
	const users = await db.collection("users");
	await users.create({ id: 1, name: "Ada" });
	await users.create({ id: 2, name: "Grace" });
	for await (const user of users.filter({ orderBy: (order) => order.desc("joinedAt") })) {
		console.log(user);
	}
} finally {
	await db.close();
}
