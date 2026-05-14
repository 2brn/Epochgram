import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
	plugins: [
		{
			name: "epochgram-bridge-favicon-inline",
			resolveId(id) {
				if (id === "epochgram-bridge-favicon") return "\0epochgram-bridge-favicon";
				if (id === "epochgram-logo-full") return "\0epochgram-logo-full";
				if (id === "epochgram-bridge-default-settings-yaml") return "\0epochgram-bridge-default-settings-yaml";
				return null;
			},
			load(id) {
				if (id === "\0epochgram-bridge-favicon") {
					const svgPath = path.resolve(__dirname, "images", "favicon.svg");
					let svg = "";
					try {
						svg = fs.readFileSync(svgPath, "utf8");
					} catch {
						svg = "";
					}
					return `export default ${JSON.stringify(svg)};`;
				}
				if (id === "\0epochgram-logo-full") {
					const svgPath = path.resolve(__dirname, "images", "epochgram-logo-full.svg");
					let svg = "";
					try {
						svg = fs.readFileSync(svgPath, "utf8");
					} catch {
						svg = "";
					}
					return `export default ${JSON.stringify(svg)};`;
				}
				if (id === "\0epochgram-bridge-default-settings-yaml") {
					const yamlPath = path.resolve(__dirname, "src", "plugin", "ai-bridge-page", "settings", "default-bridge-settings.yaml");
					let yamlText = "";
					try {
						yamlText = fs.readFileSync(yamlPath, "utf8");
					} catch {
						yamlText = "";
					}
					return `export default ${JSON.stringify(yamlText)};`;
				}
				return null;
			}
		}
	],
	test: {
		environment: "node",
		exclude: ["__temp/**", "node_modules/**", "dist/**"]
	},
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "tests/obsidian-mock.ts"),
			utils: path.resolve(__dirname, "src/utils.ts")
		}
	}
});
