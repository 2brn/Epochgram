import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";

describe("Reset tracked changes", () => {
	it("calls clearTrackedChanges + resetTrackedBaseline and persists", async () => {
		const updateAggregatedEntries = vi.fn(() => {});
		const indexer: any = {
			clearTrackedChanges: vi.fn(() => true),
			resetTrackedBaseline: vi.fn(() => true),
			updateAggregatedEntries,
			files: {
				"a.md": {
					trackedDates: { "2020-01-01": [{ file: "a.md", date: "2020-01-01", source: "tracked" }] },
					trackedSnapshot: "old",
					trackedSnapshotDate: "2020-01-01",
					trackedBaselineSnapshot: "older",
					trackedBaselineDate: "2019-12-31"
				}
			},
			index: {
				"2020-01-01": [
					{ file: "a.md", date: "2020-01-01", source: "content" },
					{ file: "a.md", date: "2020-01-01", source: "tracked" }
				]
			}
		};
		const plugin: any = {
			indexer,
			settings: {},
			ensureIndexLoaded: vi.fn(async () => {}),
			saveSettings: vi.fn(async () => {}),
			persist: vi.fn(async () => {}),
			refreshEpochViews: vi.fn(() => {})
		};

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: true,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(indexer.clearTrackedChanges).toHaveBeenCalledTimes(1);
		expect(indexer.resetTrackedBaseline).toHaveBeenCalledTimes(1);
		expect(indexer.files["a.md"].trackedSnapshot).toBe(null);
		expect(indexer.files["a.md"].trackedSnapshotDate).toBe(null);
		expect(indexer.files["a.md"].trackedBaselineSnapshot).toBe(null);
		expect(indexer.files["a.md"].trackedBaselineDate).toBe(null);
		expect(Object.keys(indexer.files["a.md"].trackedDates)).toHaveLength(0);
		expect(indexer.index["2020-01-01"].length).toBe(1);
		expect(indexer.index["2020-01-01"][0].source).toBe("content");
		expect(updateAggregatedEntries).toHaveBeenCalledTimes(1);
		expect(plugin.persist).toHaveBeenCalledTimes(1);
		expect(plugin.refreshEpochViews).toHaveBeenCalledTimes(1);
	});
});
