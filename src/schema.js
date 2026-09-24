// @ts-check
import { type } from "arktype";
import { SchemaError, ValidationError } from "./errors.js";
import { encodeData, stable, validName } from "./encoding.js";
import { indexMethod } from "./index-methods.js";

/** @param {any} definition @returns {any} */
function normalizeType(definition) {
	if (definition === "date") {
		return "Date";
	}
	if (typeof definition === "string" && definition.endsWith("?")) {
		const base = definition.slice(0, -1);
		if (base === "date") {
			return { optional: true, value: "Date" };
		}
		return { optional: true, value: base };
	}
	return definition;
}

/** @param {any} definition */
function serializableType(definition) {
	if (typeof definition === "string") {
		return definition;
	}
	if (definition && typeof definition.expression === "string") {
		return definition.expression;
	}
	if (Array.isArray(definition) || (definition && typeof definition === "object")) {
		return stable(definition);
	}
	throw new SchemaError("Column type must be an ArkType definition");
}

/** @param {import("./types.js").IndexDefinition} index @param {Record<string, import("./types.js").ColumnDefinition>} columns @returns {import("./types.js").Index} */
function normalizeIndex(index, columns) {
	if (!index || typeof index !== "object") {
		throw new SchemaError("Index must be an object");
	}
	const name = validName(index.name, "index name");
	const method = index.method ?? "btree";
	indexMethod(method);
	if (!Array.isArray(index.columns) || !index.columns.length) {
		throw new SchemaError(`Index ${name} must declare columns`);
	}
	const fields = index.columns.map((entry) => {
		let field;
		/** @type {import("./types.js").Direction} */
		let direction = "asc";
		if (typeof entry === "string") {
			field = entry;
		} else {
			field = entry?.field;
			direction = entry?.direction ?? "asc";
		}
		if (typeof field !== "string" || !field || !columns[field.split(".")[0]]) {
			throw new SchemaError(`Index ${name} references unknown column ${field}`);
		}
		if (!["asc", "desc"].includes(direction)) {
			throw new SchemaError(`Index ${name} has an invalid direction`);
		}
		return { name: field, direction };
	});
	if (new Set(fields.map((field) => field.name)).size !== fields.length) {
		throw new SchemaError(`Index ${name} repeats a column`);
	}
	return { name, method, fields, unique: index.unique === true };
}

/** @param {{ version: number }} config @param {import("./types.js").TableDefinition[]} definitions @returns {import("./types.js").CompiledSchema} */
export function compileSchema(config, definitions) {
	if (!config || !Number.isSafeInteger(config.version) || config.version < 1) {
		throw new SchemaError("Schema version must be an integer of at least 1");
	}
	if (!Array.isArray(definitions) || !definitions.length) {
		throw new SchemaError("Schema needs at least one table");
	}
	/** @type {Map<string, import("./types.js").Table>} */
	const tables = new Map();
	/** @type {Record<string, import("./types.js").StoredTable>} */
	const storedTables = {};
	for (const definition of definitions) {
		if (!definition || typeof definition !== "object") {
			throw new SchemaError("Table definition must be an object");
		}
		const name = validName(definition.table, "table name");
		if (tables.has(name)) {
			throw new SchemaError(`Duplicate table ${name}`);
		}
		const columns = definition.columns;
		if (!columns || typeof columns !== "object" || Array.isArray(columns)) {
			throw new SchemaError(`Table ${name} needs columns`);
		}
		if (
			!columns.id ||
			columns.id.primary !== true ||
			Object.entries(columns).filter(([, col]) => col?.primary).length !== 1
		) {
			throw new SchemaError(`Table ${name} must have exactly one primary column named id`);
		}
		/** @type {Record<string, any>} */
		const shape = { "+": "reject" };
		/** @type {Record<string, import("./types.js").StoredColumn>} */
		const storedColumns = {};
		for (const [columnName, column] of Object.entries(columns)) {
			validName(columnName, "column name");
			if (!column || typeof column !== "object" || !Object.hasOwn(column, "type")) {
				throw new SchemaError(`Column ${name}.${columnName} needs a type`);
			}
			const normalized = normalizeType(column.type);
			const optional = normalized?.optional === true;
			let value = normalized;
			let shapeKey = columnName;
			if (optional) {
				value = normalized.value;
				shapeKey = `${columnName}?`;
			}
			shape[shapeKey] = value;
			/** @type {import("./types.js").StoredColumn["default"]} */
			let storedDefault = null;
			if (Object.hasOwn(column, "default")) {
				if (typeof column.default === "function") {
					storedDefault = { kind: "function" };
				} else {
					storedDefault = { kind: "value", value: encodeData(column.default).toString("base64") };
				}
			}
			storedColumns[columnName] = {
				type: serializableType(column.type),
				primary: column.primary === true,
				optional,
				default: storedDefault,
			};
		}
		if (storedColumns.id.optional || !/^(number|string)(\.|$)/.test(storedColumns.id.type)) {
			throw new SchemaError(`Table ${name} id must be a required string or number`);
		}
		let validator;
		try {
			validator = type(shape).onDeepUndeclaredKey("reject");
		} catch (error) {
			throw new SchemaError(`Invalid ArkType schema for ${name}: ${error.message}`);
		}
		const indexes = (definition.indexes ?? []).map((index) => normalizeIndex(index, columns));
		if (new Set(indexes.map((index) => index.name)).size !== indexes.length) {
			throw new SchemaError(`Table ${name} repeats an index name`);
		}
		tables.set(name, { name, columns, indexes, validator });
		storedTables[name] = { columns: storedColumns, indexes };
	}
	return {
		version: config.version,
		tables,
		stored: { version: config.version, tables: storedTables },
	};
}

/** @param {object} value @returns {value is import("./types.js").Document} */
function hasValidId(value) {
	if (!("id" in value)) {
		return false;
	}
	return (
		typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id))
	);
}

/** @param {import("./types.js").Table} table @param {unknown} document @param {boolean} [applyDefaults] @returns {import("./types.js").Document} */
export function validateDocument(table, document, applyDefaults = true) {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new ValidationError("Document must be an object");
	}
	/** @type {Record<string, unknown>} */
	const candidate = { ...document };
	if (applyDefaults) {
		for (const [name, column] of Object.entries(table.columns)) {
			if (candidate[name] === undefined && Object.hasOwn(column, "default")) {
				if (typeof column.default === "function") {
					candidate[name] = column.default();
				} else {
					candidate[name] = structuredClone(column.default);
				}
			}
		}
	}
	const result = table.validator(candidate);
	if (result instanceof type.errors) {
		throw new ValidationError(
			`Document failed ${table.name} schema validation: ${result.summary}`,
			result.flatByPath,
		);
	}
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		throw new ValidationError("Document schema must produce an object");
	}
	if (!hasValidId(result)) {
		throw new ValidationError("id must be a string or finite number");
	}
	encodeData(result);
	return result;
}

/** @param {import("./types.js").StoredSchema} previous @param {import("./types.js").StoredSchema} next @returns {import("./types.js").SchemaDiff} */
export function schemaDiff(previous, next) {
	if (next.version < previous.version) {
		throw new SchemaError(
			`Schema version ${next.version} is older than stored version ${previous.version}`,
		);
	}
	if (next.version === previous.version) {
		if (stable(previous.tables) !== stable(next.tables)) {
			throw new SchemaError("Schema definition changed without increasing its version");
		}
		return { changed: false, additions: new Map() };
	}
	const additions = new Map();
	for (const [name, oldTable] of Object.entries(previous.tables)) {
		const newTable = next.tables[name];
		if (!newTable) {
			throw new SchemaError(`Removing table ${name} is not a safe migration`);
		}
		for (const [field, oldColumn] of Object.entries(oldTable.columns)) {
			if (!newTable.columns[field] || stable(oldColumn) !== stable(newTable.columns[field])) {
				throw new SchemaError(`Changing or removing ${name}.${field} is not a safe migration`);
			}
		}
		for (const oldIndex of oldTable.indexes) {
			const newIndex = newTable.indexes.find((index) => index.name === oldIndex.name);
			if (!newIndex || stable(oldIndex) !== stable(newIndex)) {
				throw new SchemaError(
					`Changing or removing index ${name}.${oldIndex.name} is not a safe migration`,
				);
			}
		}
	}
	for (const [name, newTable] of Object.entries(next.tables)) {
		const oldTable = previous.tables[name];
		additions.set(name, {
			columns: Object.keys(newTable.columns).filter((field) => !oldTable?.columns[field]),
			indexes: newTable.indexes.filter(
				(index) => !oldTable?.indexes.some((old) => old.name === index.name),
			),
		});
	}
	return { changed: true, additions };
}
