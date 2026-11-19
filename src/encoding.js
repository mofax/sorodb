// @ts-check
import { CBOR } from "cbor-ts";
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

/** @typedef {import("cbor-ts").CBORIO} CBORValue */

/** @param {unknown} value @param {boolean} deterministic */
function packData(value, deterministic) {
	const seen = new Set();
	let needsFloatFallback = false;
	/** @param {any} item @returns {CBORValue} */
	function visit(item) {
		if (item === undefined && deterministic) {
			return item;
		}
		if (item === null || typeof item === "string" || typeof item === "boolean") {
			return item;
		}
		if (typeof item === "bigint") {
			// Keep BigInts distinct from numbers, including values that fit in a CBOR integer.
			let tag = 2;
			let magnitude = item;
			if (item < 0n) {
				tag = 3;
				magnitude = -1n - item;
			}
			const hex = magnitude.toString(16);
			return CBOR.tag(tag, Buffer.from(hex.padStart(hex.length + (hex.length % 2), "0"), "hex"));
		}
		if (typeof item === "number" && Number.isFinite(item)) {
			if (deterministic && Object.is(item, -0)) {
				return 0;
			}
			if (!Number.isSafeInteger(item) || Object.is(item, -0)) {
				needsFloatFallback ||=
					Number.isInteger(item) || (!deterministic && Math.fround(item) === item);
			}
			return item;
		}
		if (item instanceof Date) {
			if (Number.isNaN(item.getTime())) {
				throw new ValidationError("Invalid Date cannot be stored");
			}
			// Preserve the original wire representation and exact millisecond precision.
			return CBOR.tag(0, item.toISOString().replace(/\.000Z$/, "Z"));
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
			result = /** @type {Record<string, CBORValue>} */ (Object.create(null));
			for (const [key, child] of Object.entries(item)) {
				result[key] = visit(child);
			}
		}
		seen.delete(item);
		return result;
	}
	const checked = visit(value);
	if (needsFloatFallback) {
		return packWithPreferredFloats(checked, deterministic);
	}
	return Buffer.from(CBOR.pack(checked, { deterministic }));
}

/**
 * Keep the original float widths for persisted schema defaults and stable keys.
 * cbor-ts only uses preferred float widths in deterministic mode (which also sorts maps),
 * and it cannot encode unsafe integer-valued numbers directly.
 * @param {CBORValue} value @param {boolean} deterministic
 */
function packWithPreferredFloats(value, deterministic) {
	/** @type {Uint8Array[]} */
	const chunks = [];
	/** @param {CBORValue} item */
	function append(item) {
		if (Array.isArray(item)) {
			const header = CBOR.pack(item.length);
			header[0] |= 0x80;
			chunks.push(header);
			item.forEach(append);
		} else if (item && typeof item === "object" && Object.getPrototypeOf(item) === null) {
			const entries = Object.entries(/** @type {Record<string, CBORValue>} */ (item)).map(
				([key, child]) => ({ key: CBOR.pack(key), child }),
			);
			if (deterministic) {
				entries.sort((a, b) => Buffer.compare(a.key, b.key));
			}
			const header = CBOR.pack(entries.length);
			header[0] |= 0xa0;
			chunks.push(header);
			for (const { key, child } of entries) {
				chunks.push(key);
				append(child);
			}
		} else if (typeof item === "number" && Number.isInteger(item) && !Number.isSafeInteger(item)) {
			if (Math.fround(item) === item) {
				const bytes = Buffer.alloc(5);
				bytes[0] = 0xfa;
				bytes.writeFloatBE(item, 1);
				chunks.push(bytes);
			} else {
				const bytes = Buffer.alloc(9);
				bytes[0] = 0xfb;
				bytes.writeDoubleBE(item, 1);
				chunks.push(bytes);
			}
		} else {
			chunks.push(CBOR.pack(item, { deterministic: true }));
		}
	}
	append(value);
	return Buffer.concat(chunks);
}

/** @param {unknown} value */
export function encodeData(value) {
	return packData(value, false);
}

/** @param {Uint8Array} bytes @returns {any} */
export function decodeData(bytes) {
	return CBOR.unpack(bytes);
}

/** @param {unknown} value */
export function stable(value) {
	return packData(value, true).toString("hex");
}
