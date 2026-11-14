import { describe, expect, it } from "vitest";

import { buildAiBridgePageHtml } from "../src/plugin/ai-bridge-page";

describe("AI bridge page Reset to defaults", () => {
	it("embeds built-in YAML defaults for initial load and Reset", () => {
		const html = buildAiBridgePageHtml("tok");

		// Built-in defaults are embedded for initial load and the Reset button.
		expect(html.includes("const BUILTIN_DEFAULTS")).toBe(true);
		expect(html.includes("settingsYaml")).toBe(true);
		expect(html.includes("Keep exact names from text or paths, not categories.")).toBe(true);
		expect(html.includes("Merge by named subject; preserve names, facts and status.")).toBe(true);
		expect(html.includes("{{filePath}}")).toBe(true);
		expect(html.includes("{{openai-key}}")).toBe(true);
		expect(html.includes("maxInputChars: 3000")).toBe(true);
		expect(html.includes("maxChunkChars: 3000")).toBe(true);

		// Reset handler should reference BUILTIN_DEFAULTS.
		expect(html.includes("makeDefaultOptionsState()")).toBe(true);
		expect(html.includes("applyOptionsStateToUi(d)")).toBe(true);
	});
});
