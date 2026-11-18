// @ts-check
import SoroDB from "../src/index.js";

/** @template T @param {string} label @param {() => Promise<T>} operation */
async function timed(label, operation) {
	const timer = `[basic] ${label}`;
	console.log(`${timer}...`);
	console.time(timer);
	try {
		return await operation();
	} finally {
		console.timeEnd(timer);
	}
}

function getRandomInt() {
	const arr = crypto.getRandomValues(Uint32Array.from({ length: 1 }));
	return arr[0];
}

// Keep database credentials separate from process-wide AWS configuration.
console.time("[basic] Total");
console.log("[basic] Configuring the database...");
console.time("[basic] Configuration");
/** @param {string} key */
function required(key) {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing ${key}; run with node --env-file=.env examples/basic.js`);
	}
	return value;
}

const db = SoroDB({
	store: required("SORODB_STORE"),
	path: required("SORODB_PATH"),
	storeConfig: {
		region: required("SORODB_REGION"),
		access_key_id: required("SORODB_ACCESS_KEY_ID"),
		secret_access_key: required("SORODB_SECRET_ACCESS_KEY"),
	},
});
db.schema({ version: 1 }, [
	{
		table: "users",
		columns: {
			id: { type: "number", primary: true },
			name: { type: "string" },
			joinedAt: { type: "date", default: () => new Date() },
		},
		indexes: [
			{
				name: "joined_at",
				columns: [{ field: "joinedAt", direction: "desc" }],
			},
		],
	},
]);
console.timeEnd("[basic] Configuration");

try {
	const users = await timed("Opening database and users collection", () => db.collection("users"));
	await timed("Querying users by joinedAt descending", async () => {
		let count = 0;
		for await (const user of users.filter({
			orderBy: (order) => order.desc("joinedAt"),
		})) {
			console.log(user);
			count++;
		}
		console.log(`[basic] Read ${count} users (query timing includes logging).`);
	});
	await timed("Creating two users in parallel", () =>
		Promise.all([
			timed("Creating Ada", () => users.create({ id: getRandomInt(), name: "Ada" })),
			timed("Creating Grace", () => users.create({ id: getRandomInt(), name: "Grace" })),
		]),
	);
	console.log("[basic] Created both users.");
} finally {
	try {
		await timed("Closing database", () => db.close());
	} finally {
		console.timeEnd("[basic] Total");
	}
}
