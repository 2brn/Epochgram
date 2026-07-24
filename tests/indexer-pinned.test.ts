import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { sortIndex } from "../src/indexer/indexer-utils";
import type { DateEntry, FileIndexData, FileDateEntry } from "../src/indexer/types";

const PATH = "folder/note.md";
const ANCHOR_DATE = "2025-01-01";
const TODAY_DATE = "2025-01-02";

const makeEntry = (overrides: Partial<FileDateEntry> = {}): FileDateEntry => ({
	date: overrides.date ?? ANCHOR_DATE,
	file: overrides.file ?? PATH,
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? 0,
	summary: overrides.summary ?? "Note",
	source: overrides.source ?? "cdate",
	reviewState: overrides.reviewState,
	pinned: overrides.pinned
});

describe("Indexer pinned entries", () => {
	let indexer: Indexer;
	let data: FileIndexData;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2025, 0, 2, 0, 0, 0, 0));
		const pluginStub: any = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 0
			}
		};
		indexer = new Indexer(pluginStub);
		data = {
			cdate: makeEntry(),
			namedDate: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			pinnedFile: "today"
		};
		(indexer as any).files = { [PATH]: data };
		(indexer as any).latestLines = { [PATH]: [] };
		(indexer as any).index = {};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("adds a pinned entry for today when anchor date differs", () => {
		(indexer as any).updateAggregatedEntries(PATH);

		const todaysEntries = indexer.index[TODAY_DATE];
		expect(todaysEntries).toBeDefined();
		expect(todaysEntries).toHaveLength(1);
		const pinned = todaysEntries![0];
		expect(pinned.pinned).toBe(true);
		expect(pinned.originalDate).toBe(ANCHOR_DATE);
		expect(pinned.summary).toBe("Note");

		const anchorEntries = indexer.index[ANCHOR_DATE];
		expect(anchorEntries).toBeDefined();
		expect(anchorEntries!.length).toBeGreaterThan(0);
		expect(anchorEntries!.every(entry => entry.pinned !== true)).toBe(true);
	});

	it("moves pinned-today entry when day changes", () => {
		(indexer as any).updateAggregatedEntries(PATH);

		const changedFirst = indexer.refreshSyntheticEntriesIfDayChanged();
		expect(changedFirst).toBe(true);
		const changedSameDay = indexer.refreshSyntheticEntriesIfDayChanged();
		expect(changedSameDay).toBe(false);

		vi.setSystemTime(new Date(2025, 0, 3, 0, 0, 0, 0));
		const changedNextDay = indexer.refreshSyntheticEntriesIfDayChanged();
		expect(changedNextDay).toBe(true);

		const oldDayEntries = indexer.index[TODAY_DATE] ?? [];
		expect(oldDayEntries.filter(e => e.file === PATH)).toHaveLength(0);
		const nextDate = "2025-01-03";
		const nextEntries = indexer.index[nextDate];
		expect(nextEntries).toBeDefined();
		expect(nextEntries).toHaveLength(1);
		expect(nextEntries![0].pinned).toBe(true);
		expect(nextEntries![0].originalDate).toBe(ANCHOR_DATE);
	});

	it("pins anchor entry in place when anchor date is today", () => {
		data.cdate = makeEntry({ date: TODAY_DATE });
		(indexer as any).updateAggregatedEntries(PATH);

		const todaysEntries = indexer.index[TODAY_DATE];
		expect(todaysEntries).toBeDefined();
		expect(todaysEntries).toHaveLength(1);
		const entry = todaysEntries![0];
		expect(entry.pinned).toBe(true);
		expect(entry.originalDate).toBeUndefined();
		expect(entry.summary).toBe("Note");
	});

	it.each(["date", "dock"] as const)("does not create pinned-today synthetic entries for pin mode %s", (mode) => {
		data.pinnedFile = mode;
		(indexer as any).updateAggregatedEntries(PATH);

		expect(indexer.index[TODAY_DATE] ?? []).toHaveLength(0);
		const anchorEntries = indexer.index[ANCHOR_DATE] ?? [];
		expect(anchorEntries.some(entry => entry.file === PATH && entry.pinned === true)).toBe(false);
	});

	it("hiding a pinned entry hides its anchor data", () => {
		(indexer as any).updateAggregatedEntries(PATH);
		const pinned = indexer.index[TODAY_DATE]![0];
		const changed = indexer.setEntryHidden(pinned, true);
		expect(changed).toBe(true);
		expect(String((data.cdate as any)?.reviewState ?? "")).toBe("hidden");
		expect(indexer.index[TODAY_DATE]![0].reviewState).toBe("hidden");
	});

	it("setting Draft/Reviewed is per-record and clears hidden for that record", () => {
		data.contentDates.push(
			makeEntry({
				source: "content",
				blockStart: 5,
				blockEnd: 5,
				summary: "Content date"
			})
		);
		(indexer as any).updateAggregatedEntries(PATH);
		const pinned = indexer.index[TODAY_DATE]![0];
		const hideChanged = indexer.setEntryHidden(pinned, true);
		expect(hideChanged).toBe(true);
		expect(indexer.index[TODAY_DATE]![0].reviewState).toBe("hidden");

		const reviewedChanged = indexer.setEntryReviewState(pinned, "reviewed");
		expect(reviewedChanged).toBe(true);
		// hidden override cleared (via signature match on pinned-today synthetic)
		expect(String((data.cdate as any)?.reviewState ?? "")).toBe("reviewed");
		(indexer as any).updateAggregatedEntries(PATH);
		expect(indexer.index[TODAY_DATE]![0].reviewState).toBe("reviewed");
		// The anchor record is the same record; it is reviewed everywhere it appears.
		const anchorRecord = indexer.index[ANCHOR_DATE]?.find(e => e.file === PATH && e.source === "cdate");
		expect(anchorRecord?.reviewState).toBe("reviewed");
		// Other records for that day remain unaffected.
		const contentRecord = indexer.index[ANCHOR_DATE]?.find(e => e.file === PATH && e.source === "content");
		expect(contentRecord?.reviewState).toBe("draft");
	});

		it("sorts only synthetic pinned-today entries first", () => {
			const date = "2025-01-03";
			const base = (overrides: Partial<DateEntry>): DateEntry => ({
				date,
				file: overrides.file ?? "file.md",
				blockStart: overrides.blockStart ?? 0,
				blockEnd: overrides.blockEnd ?? 0,
				summary: overrides.summary ?? "",
				source: overrides.source ?? "content",
				reviewState: overrides.reviewState,
				pinned: overrides.pinned ?? false,
				...overrides
			});
			const mixed: DateEntry[] = [
				base({ file: "virtual-pinned.md", source: "cdate", pinned: true, originalDate: "2025-01-01" }),
				base({ file: "tracked-pinned.md", source: "tracked", pinned: true }),
				base({ file: "content-pinned.md", source: "content", pinned: true }),
				base({ file: "tracked.md", source: "tracked", pinned: false }),
				base({ file: "content.md", source: "content", pinned: false }),
				base({ file: "namedate.md", source: "namedate", pinned: false })
			];
			const sorted = sortIndex({ [date]: mixed })[date] ?? [];
			expect(sorted.map(entry => entry.file)).toEqual([
				"virtual-pinned.md",
				"tracked-pinned.md",
				"content-pinned.md",
				"tracked.md",
				"content.md",
				"namedate.md"
			]);
		});
});
