// @ts-check
import { decode, encode } from "cbor2";
import { ValidationError } from "./errors.js";

/** @param {string} value */
const utf8 = (value) => Buffer.from(value, "utf8");
/** @param {Uint8Array} bytes */
export function part(bytes) {
	const out = Buffer.allocUnsafe(bytes.length * 2 + 2);
	let length = 0;
	for (const byte of bytes) {
		out[length++] = byte;
		if (byte === 0) {
			out[length++] = 255;
		}
	}
	out[length++] = 0;
	out[length++] = 0;
	return out.subarray(0, length);
}

/** @param {number} value */
function sortableNumber(value) {
	if (!Number.isFinite(value)) {
		throw new ValidationError("Indexed numbers must be finite");
	}
	const bytes = Buffer.alloc(8);
	let normalized = value;
	if (Object.is(value, -0)) {
		normalized = 0;
	}
	bytes.writeDoubleBE(normalized);
	if (bytes[0] & 128) {
		for (let i = 0; i < 8; i++) {
			bytes[i] ^= 255;
		}
	} else {
		bytes[0] ^= 128;
	}
	return bytes;
}

export { sortableNumber };

/** @param {unknown} name @param {string} [label] */
export function validName(name, label = "name") {
	if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
		throw new ValidationError(
			`${label} must start with a letter and contain only letters, digits, or underscores`,
		);
	}
	return name;
}

/** @param {unknown} id */
export function idBytes(id) {
	if (typeof id === "string") {
		return Buffer.concat([Buffer.from([115]), part(utf8(id))]);
	}
	if (typeof id === "number" && Number.isFinite(id)) {
		return Buffer.concat([Buffer.from([110]), sortableNumber(id)]);
	}
	throw new ValidationError("id must be a string or finite number");
}

/** @param {string} table */
export function docPrefix(table) {
	return utf8(`D\0${table}\0`);
}
/** @param {string} table @param {string | number} id */
export function docKey(table, id) {
	return Buffer.concat([docPrefix(table), idBytes(id)]);
}
/** @param {string} table @param {string} name */
export function indexPrefix(table, name) {
	return utf8(`I\0${table}\0${name}\0`);
}

/** @param {unknown} object @param {string} path @returns {unknown} */
export function getPath(object, path) {
	let value = object;
	for (const key of path.split(".")) {
		if (value == null) {
			return undefined;
		}
		value = /** @type {Record<string, unknown>} */ (Object(value))[key];
	}
	return value;
}

/** @param {Uint8Array} prefix */
export function prefixEnd(prefix) {
	const end = Buffer.from(prefix);
	for (let i = end.length - 1; i >= 0; i--) {
		if (end[i] !== 255) {
			end[i]++;
			return end.subarray(0, i + 1);
		}
	}
	return undefined;
}

/** @param {Uint8Array} prefix @param {Uint8Array} [after] */
export function range(prefix, after) {
	return {
		start: after || prefix,
		start_inclusive: !after,
		end: prefixEnd(prefix),
		end_inclusive: false,
	};
}

const cborOptions = { collapseBigInts: false, dateTag: 0 };

/** @param {unknown} value @param {boolean} [allowUndefined] @param {boolean} [normalizeNumbers] */
function checked(value, allowUndefined = false, normalizeNumbers = false) {
	const seen = new Set();
	/** @param {any} item @returns {any} */
	function visit(item) {
		if (item === undefined && allowUndefined) {
			return item;
		}
		if (
			item === null ||
			typeof item === "string" ||
			typeof item === "boolean" ||
			typeof item === "bigint"
		) {
			return item;
		}
		if (typeof item === "number" && Number.isFinite(item)) {
			if (normalizeNumbers && Object.is(item, -0)) {
				return 0;
			}
			return item;
		}
		if (item instanceof Date) {
			if (Number.isNaN(item.getTime())) {
				throw new ValidationError("Invalid Date cannot be stored");
			}
			return item;
		}
		if (item instanceof Uint8Array) {
			if (item.constructor === Uint8Array) {
				return item;
			}
			return new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
		}
		if (typeof item !== "object" || item === null) {
			throw new ValidationError("Documents must contain CBOR-compatible values");
		}
		if (seen.has(item)) {
			throw new ValidationError("Cyclic documents cannot be stored");
		}
		seen.add(item);
		let result;
		if (Array.isArray(item)) {
			result = [];
			for (let i = 0; i < item.length; i++) {
				if (!Object.hasOwn(item, i)) {
					throw new ValidationError("Sparse arrays cannot be stored");
				}
				result.push(visit(item[i]));
			}
		} else {
			if (
				Object.getPrototypeOf(item) !== Object.prototype &&
				Object.getPrototypeOf(item) !== null
			) {
				throw new ValidationError("Documents must contain plain objects");
			}
			result = /** @type {Record<string, any>} */ (Object.create(null));
			for (const [key, child] of Object.entries(item)) {
				result[key] = visit(child);
			}
		}
		seen.delete(item);
		return result;
	}
	return visit(value);
}

/** @param {unknown} value */
export function encodeData(value) {
	return Buffer.from(encode(checked(value), cborOptions));
}

/** @param {Uint8Array} bytes @returns {any} */
export function decodeData(bytes) {
	return decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
		collapseBigInts: false,
	});
}

/** @param {unknown} value */
export function stable(value) {
	return Buffer.from(encode(checked(value, true, true), { ...cborOptions, cde: true })).toString(
		"hex",
	);
}
