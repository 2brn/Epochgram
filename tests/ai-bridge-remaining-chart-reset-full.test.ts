import { describe, expect, it } from "vitest";

import { AI_BRIDGE_SCRIPT_PART1_CHUNK_B } from "../src/plugin/ai-bridge-page/script-part-ui-status";

describe("AI bridge remaining chart reset", () => {
	it("resets remaining chart baseline to full height when remaining increases", () => {
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("function resetPerfUiHistory(now, processedTokens, remainingTokens, errorTokens)");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const seedRemainingPct = Math.max(0, Math.min(1, computeRemainingPct(remainingTokens, processedTokens, errorTokens))); ".trim());
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("resetPerfUiHistory(now, processedTokens, remainingTokensAllBuckets, errorTokens);");
	});

	it("computes remaining percentage from per-reset baselines", () => {
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("function computeRemainingPct(remainingTokens, processedTokens, errorTokens)");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const total = rem + processed + errors;");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("return total > 0 ? (rem / total) : 0;");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const remainingPct = computeRemainingPct(remainingTokensAllBuckets, processedTokens, errorTokens);");
	});
});
