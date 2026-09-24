// @ts-check
import { Database } from "./storage.js";

/** @param {import("./types.js").DatabaseConfig} config */
export default function SoroDB(config) {
	return new Database(config);
}
export { SoroDB };
export {
	SoroError,
	ValidationError,
	SchemaError,
	ConflictError,
	QueryError,
	CursorError,
} from "./errors.js";
