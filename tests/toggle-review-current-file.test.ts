import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileDateEntry, FileIndexData } from "../src/indexer/types";

describe("toggleFileReviewState", () => {
	const path = "folder/note.md";
	let indexer: Indexer;
	let data: FileIndexData;
	let updateSpy: ReturnType<typeof vi.fn>;

	const makeEntry = (reviewState?: FileDateEntry["reviewState"]): FileDateEntry => ({
		date: "2025-01-01",
		file: path,
		blockStart: 0,
		blockEnd: 0,
		summary: "summary",
		source: "content",
		reviewState
	});

	beforeEach(() => {
		indexer = new Indexer({ settings: { trackChanges: false, summaryWordsCount: 7 } } as any);
		data = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [makeEntry()],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			recur: null,
			recurHiddenDates: []
		};
		(indexer as any).files = { [path]: data };
		updateSpy = (indexer as any).updateAggregatedEntries = vi.fn();
	});

	it("reviews every record when any file record is Draft or Hidden", () => {
		data.contentDates.push(makeEntry("hidden"));

		expect(indexer.toggleFileReviewState(path)).toBe("reviewed");
		expect(data.contentDates.every((entry) => entry.reviewState === "reviewed")).toBe(true);
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});

	it("returns every reviewed file record to Draft", () => {
		data.contentDates[0].reviewState = "reviewed";

		expect(indexer.toggleFileReviewState(path)).toBe("draft");
		expect(data.contentDates[0].reviewState).toBeUndefined();
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});
});