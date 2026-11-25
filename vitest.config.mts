import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
	test: { environment: "node", setupFiles: [path.resolve(root, "tests/setup.ts")], exclude: ["__temp/**", "node_modules/**", "dist/**"] },
	resolve: { alias: { obsidian: path.resolve(root, "tests/obsidian-mock.ts"), utils: path.resolve(root, "src/utils.ts") } }
});
