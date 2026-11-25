import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { sortIndex } from "../src/indexer/indexer-utils";
import { createEmptyFileIndex } from "../src/indexer/file-index-factory";
import type { DateEntry, FileIndexData } from "../src/indexer/types";
const PATH = "folder/note.md", ANCHOR_DATE = "2025-01-01", TODAY_DATE = "2025-01-02";
const entry = (overrides: Partial<DateEntry> = {}): DateEntry => ({ date: ANCHOR_DATE, file: PATH, blockStart: 0, blockEnd: 0, summary: "Note", source: "cdate", ...overrides });
describe("Indexer pinned entries", () => {
	let indexer: Indexer, data: FileIndexData;
	beforeEach(() => {
		vi.useFakeTimers(); vi.setSystemTime(new Date(2025, 0, 2));
		indexer = new Indexer({ settings: { summaryWordsCount: 0 } });
		data = { ...createEmptyFileIndex(), cdate: entry(), pinnedFile: "today" };
		(indexer as any).files = { [PATH]: data }; (indexer as any).latestLines = { [PATH]: [] };
	});
	afterEach(() => vi.useRealTimers());
	it("adds a pinned entry for today while retaining the original anchor", () => {
		(indexer as any).updateAggregatedEntries(PATH);
		expect(indexer.index[TODAY_DATE]).toHaveLength(1);
		expect(indexer.index[TODAY_DATE][0]).toMatchObject({ pinned: true, originalDate: ANCHOR_DATE, summary: "Note" });
		expect(indexer.index[ANCHOR_DATE].every(entry => !entry.pinned)).toBe(true);
	});
	it("moves pinned-today entries when the day changes", () => {
		(indexer as any).updateAggregatedEntries(PATH);
		expect(indexer.refreshSyntheticEntriesIfDayChanged()).toBe(true);
		expect(indexer.refreshSyntheticEntriesIfDayChanged()).toBe(false);
		vi.setSystemTime(new Date(2025, 0, 3));
		expect(indexer.refreshSyntheticEntriesIfDayChanged()).toBe(true);
		expect(indexer.index[TODAY_DATE] ?? []).toHaveLength(0);
		expect(indexer.index["2025-01-03"][0]).toMatchObject({ pinned: true, originalDate: ANCHOR_DATE });
	});
	it("pins a today anchor in place", () => {
		data.cdate = entry({ date: TODAY_DATE }); (indexer as any).updateAggregatedEntries(PATH);
		expect(indexer.index[TODAY_DATE]).toHaveLength(1);
		expect(indexer.index[TODAY_DATE][0].pinned).toBe(true);
		expect(indexer.index[TODAY_DATE][0].originalDate).toBeUndefined();
	});
	it.each(["date", "dock"] as const)("does not create today clones for %s", mode => {
		data.pinnedFile = mode; (indexer as any).updateAggregatedEntries(PATH);
		expect(indexer.index[TODAY_DATE] ?? []).toHaveLength(0);
		expect(indexer.index[ANCHOR_DATE].some(entry => entry.pinned)).toBe(false);
	});
	it("sorts pinned-today clones, then pinned records, content, and anchors", () => {
		const date = "2025-01-03";
		const rows = [entry({ date, file: "virtual.md", pinned: true, originalDate: ANCHOR_DATE }), entry({ date, file: "content-pin.md", source: "content", pinned: true }), entry({ date, file: "content.md", source: "content" }), entry({ date, file: "namedate.md", source: "namedate" })];
		expect(sortIndex({ [date]: rows })[date].map(row => row.file)).toEqual(["virtual.md", "content-pin.md", "content.md", "namedate.md"]);
	});
});
