import { describe, it, expect, vi } from "vitest";
import { clearTrackedChangesForPath } from "../src/indexer/tracked-baseline";

describe("clearTrackedChangesForPath", () => {
	it("clears tracked state and prunes tracked index entries only for the target file", () => {
		const updateAggregatedEntries = vi.fn(() => {});
		const indexer: any = {
			files: {
				"a.md": {
					trackedDates: {
						"2020-01-01": [{ file: "a.md", date: "2020-01-01", source: "tracked" }],
						"2020-01-02": []
					},
					trackedSnapshot: "snap-a",
					trackedSnapshotDate: "2020-01-03",
					trackedBaselineSnapshot: "base-a",
					trackedBaselineDate: "2020-01-01"
				},
				"b.md": {
					trackedDates: {
						"2020-01-01": [{ file: "b.md", date: "2020-01-01", source: "tracked" }]
					},
					trackedSnapshot: "snap-b",
					trackedSnapshotDate: "2020-01-03",
					trackedBaselineSnapshot: "base-b",
					trackedBaselineDate: "2020-01-01"
				}
			},
			index: {
				"2020-01-01": [
					{ file: "a.md", date: "2020-01-01", source: "tracked" },
					{ file: "b.md", date: "2020-01-01", source: "tracked" }
				],
				"2020-01-02": [
					{ file: "a.md", date: "2020-01-02", source: "tracked" },
					{ file: "a.md", date: "2020-01-02", source: "content" }
				]
			},
			updateAggregatedEntries
		};

		const changed = clearTrackedChangesForPath(indexer, "a.md");
		expect(changed).toBe(true);

		expect(Object.keys(indexer.files["a.md"].trackedDates)).toHaveLength(0);
		expect(indexer.files["a.md"].trackedBaselineSnapshot).toBe("snap-a");
		expect(indexer.files["a.md"].trackedBaselineDate).toBe("2020-01-03");

		expect(Object.keys(indexer.files["b.md"].trackedDates)).toHaveLength(1);
		expect(indexer.files["b.md"].trackedBaselineSnapshot).toBe("base-b");
		expect(indexer.files["b.md"].trackedBaselineDate).toBe("2020-01-01");

		expect(indexer.index["2020-01-01"]).toEqual([
			{ file: "b.md", date: "2020-01-01", source: "tracked" }
		]);
		expect(indexer.index["2020-01-02"]).toEqual([
			{ file: "a.md", date: "2020-01-02", source: "content" }
		]);

		expect(updateAggregatedEntries).toHaveBeenCalledTimes(1);
		expect(updateAggregatedEntries).toHaveBeenCalledWith("a.md", { skipSort: true });
	});
});
