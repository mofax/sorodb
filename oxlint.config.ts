import { defineConfig } from "oxlint";

export default defineConfig({
	rules: {
		"no-ternary": "error",
		curly: ["error", "all"],
	},
});
