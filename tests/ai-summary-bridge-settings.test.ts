import { describe, expect, it } from "vitest";

import { validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";
import { getAiSummaryTuning } from "../src/plugin/ai-summaries/bridge-settings";

describe("AI summary bridge settings", () => {
	it("uses settingsYaml to get tuning values", () => {
		const stored = validateBridgeOptionsYaml([
			"maxRelatedChars: 1500",
			"records:",
			"  maxInputChars: 24000",
			"reduce:",
			"  maxDepth: 4",
			"  maxChunkChars: 2500"
		].join("\n")).stored;

		const plugin: any = {
			settings: {
				aiBridgeOptions: {
					settingsYaml: stored.settingsYaml
				}
			}
		};

		const tuning = getAiSummaryTuning(plugin);
		expect(tuning.recordsMaxInputChars).toBe(24000);
		expect(tuning.maxRelatedChars).toBe(1500);
		expect(tuning.reduceMaxDepth).toBe(4);
		expect(tuning.maxChunkChars).toBe(2500);
	});
});