import { describe, it, expect, beforeEach, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileIndexData } from "../src/indexer/types";

describe("Indexer reviewState", () => {
	let indexer: Indexer;
	let data: FileIndexData;
	let updateSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		const pluginStub: any = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 7
			}
		};
		indexer = new Indexer(pluginStub);
		data = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			recur: null
		};
		(data as any).contentDates = [
			{
				date: "2025-01-01",
				file: "folder/note.md",
				blockStart: 0,
				blockEnd: 0,
				summary: "summary",
				source: "content"
			}
		];
		(indexer as any).files = { "folder/note.md": data };
		updateSpy = (indexer as any).updateAggregatedEntries = vi.fn();
	});

	it("sets per-record Reviewed override and triggers re-aggregation", () => {
		const changed = indexer.setFileReviewStateForAllRecords("folder/note.md", "reviewed");
		expect(changed).toBe(true);
		expect((data as any).contentDates?.[0]?.reviewState).toBe("reviewed");
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});

	it("returns false when file records are already reviewed", () => {
		(data as any).contentDates[0].reviewState = "reviewed";
		const changed = indexer.setFileReviewStateForAllRecords("folder/note.md", "reviewed");
		expect(changed).toBe(false);
		expect(updateSpy).not.toHaveBeenCalled();
	});

	it("draft removes per-record overrides", () => {
		(data as any).contentDates[0].reviewState = "reviewed";
		const changed = indexer.setFileReviewStateForAllRecords("folder/note.md", "draft");
		expect(changed).toBe(true);
		expect((data as any).contentDates?.[0]?.reviewState).toBeUndefined();
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});
});
