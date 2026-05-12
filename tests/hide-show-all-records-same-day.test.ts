import { describe, it, expect, beforeEach } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileDateEntry } from "../src/indexer/types";

const PATH = "folder/note.md";
const DAY = "2026-03-01";

const entry = (overrides: Partial<FileDateEntry>): FileDateEntry => {
	const blockStart = overrides.blockStart ?? 0;
	return {
		...overrides,
		date: overrides.date ?? DAY,
		file: overrides.file ?? PATH,
		blockStart,
		blockEnd: overrides.blockEnd ?? blockStart,
		summary: overrides.summary ?? "",
		source: overrides.source ?? "content"
	} as FileDateEntry;
};

describe("Hide/Show applies to all note records for the day", () => {
	let indexer: Indexer;
	let data: any;

	beforeEach(() => {
		const pluginStub: any = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 0
			}
		};
		indexer = new Indexer(pluginStub);
		data = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [
				entry({ source: "content", blockStart: 1, summary: "A" }),
				entry({ source: "content", blockStart: 10, summary: "B" })
			],
			trackedDates: {
				[DAY]: [entry({ source: "tracked", blockStart: 0, summary: "Tracked", trackedChange: "modified" as any })]
			},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			reviewState: "draft"
		};
		(indexer as any).files = { [PATH]: data };
		(indexer as any).latestLines = { [PATH]: [] };
		(indexer as any).index = {};
	});

	it("hides/unhides every record from the file on that date", () => {
		(indexer as any).updateAggregatedEntries(PATH);

		const before = (indexer.index[DAY] ?? []).filter((e) => e.file === PATH);
		expect(before.length).toBeGreaterThan(1);
		expect(before.some((e) => e.reviewState !== "hidden")).toBe(true);

		expect(indexer.setEntryHidden(before[0], true)).toBe(true);

		const afterHide = (indexer.index[DAY] ?? []).filter((e) => e.file === PATH);
		expect(afterHide.length).toBeGreaterThan(1);
		expect(afterHide.every((e) => e.reviewState === "hidden")).toBe(true);

		// Underlying per-file entries for that day are all hidden too.
		const fileEntriesForDay = [
			...(data.contentDates ?? []),
			...((data.trackedDates ?? {})[DAY] ?? [])
		];
		expect(fileEntriesForDay.length).toBe(3);
		expect(fileEntriesForDay.every((e: any) => e.reviewState === "hidden")).toBe(true);

		expect(indexer.setEntryHidden(afterHide[0], false)).toBe(true);

		const afterShow = (indexer.index[DAY] ?? []).filter((e) => e.file === PATH);
		expect(afterShow.length).toBeGreaterThan(1);
		expect(afterShow.every((e) => e.reviewState !== "hidden")).toBe(true);
	});
});
