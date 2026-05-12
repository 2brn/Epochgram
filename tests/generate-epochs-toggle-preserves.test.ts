import { describe, expect, it } from "vitest";
import { settingsHandlerMethods } from "../src/plugin/settings-handler";

describe("Generate epochs toggle", () => {
	it("disabling generateEpochs does not delete existing epoch entries", async () => {
		const index: Record<string, any[]> = {
			"2025-01-01": [
				{
					date: "2025-01-01",
					file: "a.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Hello"
				},
				{
					date: "2025-01-01",
					file: "epoch://day/2025-01-01-2025-01-01",
					blockStart: 0,
					blockEnd: 0,
					source: "epoch",
					epochBucket: "day",
					epochStart: "2025-01-01",
					epochEnd: "2025-01-01",
					summary: "Already summarized",
					aiSummaryInputHash: "hash"
				}
			]
		};

		const plugin: any = {
			settings: { generateEpochs: false },
			viewPreferences: { showEpochsView: true },
			indexer: { index },
			saveSettings: async () => {},
			ensureIndexLoaded: async () => {},
			refreshEpochViews: () => {}
		};

		await settingsHandlerMethods.onSettingsChanged.call(plugin, "generateEpochs" as any);
		expect(plugin.viewPreferences.showEpochsView).toBe(false);
		expect(Array.isArray(plugin.indexer.index["2025-01-01"]))
			.toBe(true);
		expect(plugin.indexer.index["2025-01-01"].some((e: any) => e?.source === "epoch"))
			.toBe(true);
	});
});
