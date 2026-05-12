import { describe, expect, it } from "vitest";

import { buildAiBridgePageHtml } from "../src/plugin/ai-bridge-page";

describe("AI bridge page Reset to defaults", () => {
	it("keeps empty-by-default contexts but embeds built-in defaults for Reset", () => {
		const html = buildAiBridgePageHtml("tok");

		// Empty-by-default on first load.
		expect(html.includes("const DEFAULTS")).toBe(true);
		expect(html.includes('summaryCtxTemplate: ""')).toBe(true);
		expect(html.includes('epochCtxTemplate: ""')).toBe(true);

		// Built-in defaults are embedded for the Reset button.
		expect(html.includes("const BUILTIN_DEFAULTS")).toBe(true);
		expect(html.includes("Related context:")).toBe(true);
		expect(html.includes("{{filePath}}")).toBe(true);
		expect(html.includes("{{related}}")).toBe(true);

		// Reset handler should reference BUILTIN_DEFAULTS.
		expect(html.includes("BUILTIN_DEFAULTS.summaryCtxTemplate")).toBe(true);
		expect(html.includes("BUILTIN_DEFAULTS.epochCtxTemplate")).toBe(true);
	});
});
