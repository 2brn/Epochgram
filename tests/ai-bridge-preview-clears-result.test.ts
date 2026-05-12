import { describe, expect, it } from "vitest";

import { AI_BRIDGE_SCRIPT_PART3 } from "../src/plugin/ai-bridge-page/script-part-runner";

describe("AI bridge UI", () => {
	it("does not clear summarization result when text preview updates", () => {
		const matches = AI_BRIDGE_SCRIPT_PART3.match(/sumResultEl\) sumResultEl\.textContent = "";/g) ?? [];
		// Only the Clear queue handler should clear the result.
		expect(matches.length).toBe(1);
		expect(AI_BRIDGE_SCRIPT_PART3).not.toMatch(
			/curTextEl\.textContent\s*=\s*String\(job\.input[\s\S]*?sumResultEl\) sumResultEl\.textContent = "";[\s\S]*?const t = pickTemplatesForJob\(job\);/
		);
	});
});
