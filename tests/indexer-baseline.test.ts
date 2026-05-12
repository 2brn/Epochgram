import { describe, it, expect, beforeEach } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileIndexData, FileDateEntry } from "../src/indexer/types";

const makeEntry = (overrides: Partial<FileDateEntry> = {}): FileDateEntry => ({
	date: overrides.date ?? "2025-11-26",
	file: overrides.file ?? "note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? 0,
	summary: overrides.summary ?? "Summary",
	source: overrides.source ?? "tracked",
	hidden: overrides.hidden ?? false,
	pinned: overrides.pinned
});
describe("Indexer baseline reset", () => {
	let indexer: Indexer;
	const pluginStub: any = {
		settings: {
			trackChanges: true,
			summaryWordsCount: 5
		}
	};

	beforeEach(() => {
		indexer = new Indexer(pluginStub);
	});

	it("clears tracked entries and recomputes aggregated index", () => {
		const tracked = makeEntry({ summary: "Tracked", source: "tracked" });
		const cdate = makeEntry({ date: "2024-01-01", source: "cdate" });
		const data: FileIndexData = {
			cdate: { ...cdate },
			namedDate: null,
			contentDates: [],
			trackedDates: { [tracked.date]: [{ ...tracked }] },
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null
		};
		(indexer as any).files = { [tracked.file]: data };
		(indexer as any).latestLines = { [tracked.file]: ["Alpha"] };
		(indexer as any).index = {
			[tracked.date]: [{ ...tracked }],
			[cdate.date]: [{ ...cdate }]
		};

		const removed = indexer.resetTrackedBaseline();

		expect(removed).toBe(true);
		expect(Object.keys((indexer as any).files[tracked.file].trackedDates)).toHaveLength(0);
		for (const entries of Object.values(indexer.index)) {
			for (const entry of entries) {
				expect(entry.source).not.toBe("tracked");
			}
		}
	});

	it("prunes tracked entries when no per-file history exists", () => {
		const tracked = makeEntry({ summary: "Tracked", source: "tracked" });
		const cdate = makeEntry({ date: "2024-01-01", source: "cdate" });
		const data: FileIndexData = {
			cdate: { ...cdate },
			namedDate: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null
		};
		(indexer as any).files = { [tracked.file]: data };
		(indexer as any).index = {
			[tracked.date]: [{ ...tracked }],
			[cdate.date]: [{ ...cdate }]
		};

		const removed = indexer.resetTrackedBaseline();

		expect(removed).toBe(false);
		expect(indexer.index[tracked.date]).toBeUndefined();
		for (const entries of Object.values(indexer.index)) {
			for (const entry of entries) {
				expect(entry.source).not.toBe("tracked");
			}
		}
	});
});
