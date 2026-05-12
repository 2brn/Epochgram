import { describe, it, expect, beforeEach, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileIndexData, FileDateEntry } from "../src/indexer/types";

describe("toggleFileVisibility", () => {
	let indexer: Indexer;
	let data: FileIndexData;
	let updateSpy: ReturnType<typeof vi.fn>;
	const path = "folder/note.md";

	const makeEntry = (overrides: Partial<FileDateEntry> = {}): FileDateEntry => ({
		date: overrides.date ?? "2025-01-01",
		file: overrides.file ?? path,
		blockStart: overrides.blockStart ?? 0,
		blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
		summary: overrides.summary ?? "summary",
		source: overrides.source ?? "content",
		reviewState: overrides.reviewState
	});

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
			contentDates: [makeEntry()],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			recur: null,
			recurHiddenDates: [],
		};
		(indexer as any).files = { [path]: data };
		updateSpy = (indexer as any).updateAggregatedEntries = vi.fn();
	});

	it("hides the whole file when not already hidden", () => {
		const result = indexer.toggleFileVisibility(path);
		expect(result).toBe("hidden");
		expect((data.contentDates[0] as any).reviewState).toBe("hidden");
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});

	it("unhides and clears hidden overrides", () => {
		(data.contentDates[0] as any).reviewState = "hidden";
		(data as any).recurHiddenDates = ["2025-01-01"];
		(data as any).recurReviewedDates = ["2025-01-01"];

		const result = indexer.toggleFileVisibility(path);
		expect(result).toBe("visible");
		expect((data.contentDates[0] as any).reviewState).toBeUndefined();
		expect((data as any).recurHiddenDates).toEqual([]);
		expect((data as any).recurReviewedDates).toEqual([]);
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});
});
