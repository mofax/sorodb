// @ts-check
export class SoroError extends Error {
	/** @param {string} message @param {string} code @param {unknown} [details] */
	constructor(message, code, details) {
		super(message);
		this.name = this.constructor.name;
		this.code = code;
		if (details !== undefined) {
			this.details = details;
		}
	}
}

export class ValidationError extends SoroError {
	/** @param {string} message @param {unknown} [details] */
	constructor(message, details) {
		super(message, "VALIDATION_ERROR", details);
	}
}
export class SchemaError extends SoroError {
	/** @param {string} message @param {unknown} [details] */
	constructor(message, details) {
		super(message, "SCHEMA_ERROR", details);
	}
}
export class ConflictError extends SoroError {
	/** @param {string} message @param {unknown} [details] */
	constructor(message, details) {
		super(message, "CONFLICT", details);
	}
}
export class QueryError extends SoroError {
	/** @param {string} message @param {unknown} [details] */
	constructor(message, details) {
		super(message, "QUERY_ERROR", details);
	}
}
export class CursorError extends SoroError {
	/** @param {string} message @param {unknown} [details] */
	constructor(message, details) {
		super(message, "CURSOR_ERROR", details);
	}
}
