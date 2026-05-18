import { describe, expect, it, vi } from "vitest";

import { indexingMethods } from "../src/plugin/indexing";
import * as summaryStore from "../src/plugin/ai-summaries/epoch-summaries-store";

function stripAiFields(entry: any): void {
	if (!entry) return;
	delete entry.aiSummary;
	delete entry.aiSummaryInputHash;
	delete entry.aiSummaryVisible;
}

describe("index refresh", () => {
	it("reapplies saved AI summaries after a refresh", async () => {
		const loadSpy = vi
			.spyOn(summaryStore, "loadEpochSummariesFromDisk")
			.mockResolvedValue({
				epochsByDate: {},
				aiSummaries: {
					"a.md|2025-01-01|anchor": {
						s: "Saved AI summary",
						h: "saved-hash",
						v: 1
					}
				}
			} as any);

		const refreshEpochViews = vi.fn();
		const plugin: any = {
			settings: {
				trackChanges: false,
				summarizeAI: true,
				summaryWordsCount: 5,
				filenameWordsCount: 2
			},
			indexReady: true,
			indexLoadPromise: null,
			hasProAccess: () => true,
			refreshExcludedMatchers: () => false,
			waitForExcludedSync: async () => {},
			getIndexableFiles: () => [{ path: "a.md" }],
			refreshEpochViews,
			persist: async () => {},
			app: {
				workspace: {
					getLeavesOfType: () => []
				}
			},
			indexer: {
				plugin: null,
				latestLines: {},
				buildMergedDates: (data: any) => {
					const out: any[] = [];
					for (const e of Array.isArray(data?.contentDates) ? data.contentDates : []) out.push(e);
					for (const entries of Object.values(data?.trackedDates ?? {})) {
						for (const e of Array.isArray(entries) ? entries : []) out.push(e);
					}
					return out;
				},
				today: () => new Date("2025-01-01T00:00:00Z"),
				getIndexedPaths: () => ["a.md"],
				files: {
					"a.md": {
						cdate: {
							file: "a.md",
							date: "2025-01-01",
							source: "cdate",
							summary: "Base summary",
							aiSummary: "Old AI summary",
							aiSummaryInputHash: "old-hash",
							aiSummaryVisible: false
						},
						namedDate: null,
						dateProp: null,
						contentDates: [],
						trackedDates: {}
					}
				},
				index: {
					"2025-01-01": [
						{
							file: "a.md",
							date: "2025-01-01",
							source: "cdate",
							summary: "Base summary",
							aiSummary: "Old AI summary",
							aiSummaryInputHash: "old-hash",
							aiSummaryVisible: false
						}
					]
				},
				reprocessAll: vi.fn(async () => {
					const fileData = (plugin as any).indexer.files["a.md"];
					stripAiFields(fileData.cdate);
					const entries = (plugin as any).indexer.index["2025-01-01"] ?? [];
					for (const entry of entries) {
						stripAiFields(entry);
					}
				})
			}
		};
		plugin.indexer.plugin = plugin;

		await indexingMethods.runIndexOperation.call(plugin, "refresh", {
			skipEnsure: true,
			suppressNotices: true
		});

		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(plugin.indexer.files["a.md"].cdate.aiSummary).toBe("Saved AI summary");
		expect(plugin.indexer.files["a.md"].cdate.aiSummaryInputHash).toBe("saved-hash");
		expect(plugin.indexer.index["2025-01-01"][0].aiSummary).toBe("Saved AI summary");
		expect(plugin.indexer.index["2025-01-01"][0].aiSummaryInputHash).toBe("saved-hash");
		expect(plugin.indexer.index["2025-01-01"][0].summary).toBe("Saved AI summary");
		expect(refreshEpochViews).toHaveBeenCalledTimes(1);
	});
});
