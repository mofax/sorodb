import { readFileSync, writeFileSync } from "node:fs";

const entry = new URL("../types/index.d.ts", import.meta.url);
const reference = '/// <reference types="node" />\n';
const declaration = readFileSync(entry, "utf8");

if (!declaration.startsWith(reference)) {
	writeFileSync(entry, reference + declaration);
}
