import { describe, expect, it } from "vitest";

import { AI_BRIDGE_SCRIPT_PART3 } from "../src/plugin/ai-bridge-page/script-part-runner";

describe("AI bridge summarization", () => {
	it("retries summarize errors up to 3 times", () => {
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("async function retryUpTo3");
		expect(AI_BRIDGE_SCRIPT_PART3).toMatch(/for \(let attempt = 1; attempt <= 3; attempt\+\+\)/);
		// Ensure the summarize call is wrapped.
		expect(AI_BRIDGE_SCRIPT_PART3).toMatch(/const out = await retryUpTo3\(/);
	});
});
