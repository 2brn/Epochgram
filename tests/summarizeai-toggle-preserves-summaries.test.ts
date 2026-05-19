import { describe, expect, it } from "vitest";
import { settingsHandlerMethods } from "../src/plugin/settings-handler";
import { computeAiSummaryInputHash } from "../src/utils";

const CONTENT_HASH = computeAiSummaryInputHash("a.md", "2025-01-01|content", "Hello", 3000);

describe("Auto summarize toggle", () => {
	it("disabling summarizeAI does not remove stored aiSummary fields", async () => {
		const fileEntry: any = {
			date: "2025-01-01",
			file: "a.md",
			blockStart: 0,
			blockEnd: 0,
			source: "content",
			summary: "Base",
			aiSummary: "AI preserved summary",
			aiSummaryInputHash: CONTENT_HASH
		};

		const plugin: any = {
			settings: { summarizeAI: false, trackChanges: false, summaryWordsCount: 12 },
			saveSettings: async () => {},
			ensureIndexLoaded: async () => {},
			refreshEpochViews: () => {},
			hasProAccess: () => true,
			indexer: {
				plugin: null,
				index: {},
				files: {
					"a.md": {
						cdate: null,
						namedDate: null,
						contentDates: [fileEntry],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null
					}
				},
				latestLines: { "a.md": ["Hello"] },
				buildMergedDates: (data: any) => Array.isArray(data?.contentDates) ? data.contentDates : [],
				today: () => new Date("2025-01-01T00:00:00Z"),
				getIndexedPaths: () => ["a.md"]
			}
		};

		plugin.indexer.plugin = plugin;

		await settingsHandlerMethods.onSettingsChanged.call(plugin, "summarizeAI" as any);

		expect(plugin.indexer.files["a.md"].contentDates[0].aiSummaryInputHash).toBe(CONTENT_HASH);

		const indexed = plugin.indexer.index["2025-01-01"] ?? [];
		const hasAi = Array.isArray(indexed) && indexed.some((e: any) => e?.aiSummary === "AI preserved summary" && e?.aiSummaryInputHash === CONTENT_HASH);
		expect(hasAi).toBe(true);
	});
});
