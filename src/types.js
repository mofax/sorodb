// @ts-check

/** @typedef {"asc" | "desc"} Direction */
/** @typedef {Record<string, unknown> & { id: string | number }} Document */
/** @typedef {{ store: string, path: string, cursorTtlMs?: number }} DatabaseConfig */
/** @typedef {string | import("arktype").Type<unknown> | readonly ArkTypeValue[] | { [key: string]: ArkTypeValue }} ArkTypeDefinition */
/** @typedef {ArkTypeDefinition | null | boolean | number | bigint | Date | Uint8Array} ArkTypeValue */
/** @typedef {null | boolean | number | string | bigint | Date | Uint8Array | readonly DataValue[] | { [key: string]: DataValue }} DataValue */
/** @typedef {{ type: ArkTypeDefinition, primary?: boolean, default?: DataValue | (() => DataValue) }} ColumnDefinition */
/** @typedef {{ name: string, method?: "btree", columns: (string | { field: string, direction?: Direction })[], unique?: boolean }} IndexDefinition */
/** @typedef {{ table: string, columns: Record<string, ColumnDefinition>, indexes?: IndexDefinition[] }} TableDefinition */
/** @typedef {{ name: string, direction: Direction }} IndexField */
/** @typedef {{ name: string, method: "btree", fields: IndexField[], unique: boolean }} Index */
/** @typedef {{ name: string, columns: Record<string, ColumnDefinition>, indexes: Index[], validator: (document: unknown) => unknown }} Table */
/** @typedef {{ type: string, primary: boolean, optional: boolean, default: null | { kind: string, value?: string } }} StoredColumn */
/** @typedef {{ columns: Record<string, StoredColumn>, indexes: Index[] }} StoredTable */
/** @typedef {{ version: number, tables: Record<string, StoredTable> }} StoredSchema */
/** @typedef {{ version: number, tables: Map<string, Table>, stored: StoredSchema }} CompiledSchema */
/** @typedef {{ changed: boolean, additions: Map<string, { columns: string[], indexes: Index[] }> }} SchemaDiff */
/** @typedef {import("@slatedb/uniffi").Db | import("@slatedb/uniffi").DbSnapshot | import("@slatedb/uniffi").DbTransaction} Reader */
/** @typedef {{ snapshot: import("@slatedb/uniffi").DbSnapshot, fingerprint: string, lastUsed: number, active: number, timer?: NodeJS.Timeout }} Session */
/** @typedef {{ op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "startsWith" | "exists", path: string, value: unknown }} Predicate */
/** @typedef {{ op: "and", conditions: WhereNode[] } | { op: "or", conditions: WhereNode[] } | { op: "not", condition: WhereNode } | Predicate} WhereNode */
/** @typedef {{ eq: (path: string, value: unknown) => WhereNode, ne: (path: string, value: unknown) => WhereNode, gt: (path: string, value: unknown) => WhereNode, gte: (path: string, value: unknown) => WhereNode, lt: (path: string, value: unknown) => WhereNode, lte: (path: string, value: unknown) => WhereNode, in: (path: string, value: unknown[]) => WhereNode, contains: (path: string, value: unknown) => WhereNode, startsWith: (path: string, value: string) => WhereNode, exists: (path: string, value?: boolean) => WhereNode, and: (...conditions: WhereNode[]) => WhereNode, or: (...conditions: WhereNode[]) => WhereNode, not: (condition: WhereNode) => WhereNode }} WhereBuilder */
/** @typedef {{ asc: (path: string) => OrderBuilder, desc: (path: string) => OrderBuilder }} OrderBuilder */
/** @typedef {{ where?: (builder: WhereBuilder) => WhereNode, orderBy?: (builder: OrderBuilder) => unknown, select?: string[], limit?: number, cursor?: string }} QueryOptions */
/** @typedef {{ id: string, last: Buffer, fingerprint: string }} Cursor */

export {};
