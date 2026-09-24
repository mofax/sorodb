// @ts-check
import { ConflictError } from "./errors.js";
import { docKey } from "./encoding.js";
import { indexKey } from "./index-methods.js";

/** @param {import("@slatedb/uniffi").DbTransaction} tx @param {import("./types.js").Table} table @param {import("./types.js").Document} document @param {import("./types.js").Index[]} [indexes] */
export async function removeIndexes(tx, table, document, indexes = table.indexes) {
	for (const index of indexes) {
		const key = indexKey(table.name, index, document);
		if (key) {
			await tx.delete(key);
		}
	}
}

/** @param {import("@slatedb/uniffi").DbTransaction} tx @param {import("./types.js").Table} table @param {import("./types.js").Document} document @param {import("./types.js").Index[]} [indexes] */
export async function addIndexes(tx, table, document, indexes = table.indexes) {
	const keyOfDocument = docKey(table.name, document.id);
	for (const index of indexes) {
		const key = indexKey(table.name, index, document);
		if (!key) {
			continue;
		}
		if (index.unique) {
			const existing = await tx.get(key);
			if (existing && !Buffer.from(existing).equals(keyOfDocument)) {
				throw new ConflictError(`Unique index ${table.name}.${index.name} already has this value`);
			}
		}
		await tx.put(key, keyOfDocument);
	}
}
