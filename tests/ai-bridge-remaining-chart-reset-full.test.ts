import { describe, expect, it } from "vitest";

import { AI_BRIDGE_SCRIPT_PART1_CHUNK_B } from "../src/plugin/ai-bridge-page/script-part-ui-status";

describe("AI bridge remaining chart reset", () => {
	it("resets remaining chart baseline to full height when remaining increases", () => {
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("forceRemainingFull");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const seedRemainingPct = forceRemainingFull");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("? 1");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("resetPerfUiHistory(now, processedTokens, remainingTokensAllBuckets, errorTokens, { forceRemainingFull: true });");
	});

	it("computes remaining percentage from per-reset baselines", () => {
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("let remainingPctProcessedBase = 0;");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("let remainingPctErrorBase = 0;");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const processedDelta = Math.max(0, processed - Math.max(0, Number(remainingPctProcessedBase) || 0));");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const errorDelta = Math.max(0, errors - Math.max(0, Number(remainingPctErrorBase) || 0));");
		expect(AI_BRIDGE_SCRIPT_PART1_CHUNK_B).toContain("const remainingPct = computeRemainingPctFromReset(remainingTokensAllBuckets, processedTokens, errorTokens);");
	});
});
