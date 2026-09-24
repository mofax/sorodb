// @ts-check
import { SchemaError, ValidationError } from "./errors.js";
import { docKey, getPath, indexPrefix, part, sortableNumber } from "./encoding.js";

/** @param {bigint} value */
function sortableBigInt(value) {
	if (value === 0n) {
		return Buffer.from([1]);
	}
	const negative = value < 0n;
	let magnitude = value;
	if (negative) {
		magnitude = -value;
	}
	const hex = magnitude.toString(16);
	let paddedHex = hex;
	if (hex.length % 2) {
		paddedHex = `0${hex}`;
	}
	const digits = Buffer.from(paddedHex, "hex");
	const length = Buffer.alloc(8);
	length.writeBigUInt64BE(BigInt(digits.length));
	if (negative) {
		for (let i = 0; i < length.length; i++) {
			length[i] ^= 255;
		}
		for (let i = 0; i < digits.length; i++) {
			digits[i] ^= 255;
		}
	}
	let sign = 2;
	if (negative) {
		sign = 0;
	}
	return Buffer.concat([Buffer.from([sign]), length, digits]);
}

/** @param {unknown} value */
function supportsBtreeValue(value) {
	return (
		value === undefined ||
		value === null ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		typeof value === "bigint" ||
		typeof value === "string" ||
		(value instanceof Date && !Number.isNaN(value.getTime())) ||
		value instanceof Uint8Array
	);
}

/** @param {unknown} value @param {import("./types.js").Direction} [direction] */
function btreeScalar(value, direction = "asc") {
	let bytes;
	if (value === undefined) {
		bytes = Buffer.from([0]);
	} else if (value === null) {
		bytes = Buffer.from([16]);
	} else if (value === false) {
		bytes = Buffer.from([32]);
	} else if (value === true) {
		bytes = Buffer.from([33]);
	} else if (typeof value === "number") {
		bytes = Buffer.concat([Buffer.from([48]), sortableNumber(value)]);
	} else if (typeof value === "bigint") {
		bytes = Buffer.concat([Buffer.from([56]), sortableBigInt(value)]);
	} else if (value instanceof Date && !Number.isNaN(value.getTime())) {
		bytes = Buffer.concat([Buffer.from([64]), sortableNumber(value.getTime())]);
	} else if (typeof value === "string") {
		bytes = Buffer.concat([Buffer.from([80]), part(Buffer.from(value, "utf8"))]);
	} else if (value instanceof Uint8Array) {
		bytes = Buffer.concat([Buffer.from([96]), part(value)]);
	} else {
		throw new ValidationError("btree indexes support scalars, Dates, BigInts, and byte arrays");
	}
	if (direction === "desc") {
		return Buffer.from(bytes.map((byte) => byte ^ 255));
	}
	return bytes;
}

const btree = {
	supportsValue: supportsBtreeValue,
	encodeValue: btreeScalar,
	/** @param {import("./types.js").Index} index @param {import("./types.js").IndexField[]} order */
	supportsOrder: (index, order) =>
		order.every(
			(field, i) =>
				index.fields[i]?.name === field.name && index.fields[i]?.direction === field.direction,
		),
	/** @param {string} table @param {import("./types.js").Index} index @param {string} path @param {unknown} value */
	equalityPrefix(table, index, path, value) {
		if (
			index.fields[0]?.name !== path ||
			index.fields[0].direction !== "asc" ||
			!supportsBtreeValue(value)
		) {
			return null;
		}
		return Buffer.concat([indexPrefix(table, index.name), btreeScalar(value)]);
	},
};

/** @type {Record<string, typeof btree>} */
const methods = { btree };

/** @param {string} name */
export function indexMethod(name) {
	if (!Object.hasOwn(methods, name)) {
		throw new SchemaError(`Unsupported index method ${name}`);
	}
	return methods[name];
}

/** @param {string} table @param {import("./types.js").Index} index @param {import("./types.js").Document} doc */
export function indexKey(table, index, doc) {
	const method = indexMethod(index.method);
	const values = [];
	for (const field of index.fields) {
		const value = getPath(doc, field.name);
		if (value === undefined && index.unique) {
			return null;
		}
		values.push(method.encodeValue(value, field.direction));
	}
	const prefix = Buffer.concat([indexPrefix(table, index.name), ...values]);
	if (index.unique) {
		return prefix;
	}
	return Buffer.concat([prefix, part(docKey(table, doc.id))]);
}
