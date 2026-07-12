import { describe, expect, it } from "vitest";

import { AI_BRIDGE_SCRIPT_PART3 } from "../src/plugin/ai-bridge-page/script-part-runner";

describe("AI bridge summarization", () => {
	it("uses backend.maxRetries for summarize retries", () => {
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("function resolveMaxRetries(backend)");
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("backend ? backend.maxRetries");
		expect(AI_BRIDGE_SCRIPT_PART3).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/);
		// Ensure the summarize call is wrapped.
		expect(AI_BRIDGE_SCRIPT_PART3).toMatch(/const out = await retryWithLimit\(/);
	});
});
