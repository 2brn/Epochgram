import { describe, it, expect, beforeEach } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import type { FileDateEntry, FileIndexData } from "../src/indexer/types";

const PATH = "folder/note.md";
const DAY = "2025-01-01";

const makeEntry = (overrides: Partial<FileDateEntry> = {}): FileDateEntry => ({
	date: overrides.date ?? DAY,
	file: overrides.file ?? PATH,
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? 0,
	summary: overrides.summary ?? "Note",
	source: overrides.source ?? "cdate",
	reviewState: overrides.reviewState,
	pinned: overrides.pinned
});

describe("Indexer review state propagation", () => {
	let indexer: Indexer;
	let data: FileIndexData;

	beforeEach(() => {
		const pluginStub: any = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 0
			}
		};
		indexer = new Indexer(pluginStub);
		data = {
			cdate: makeEntry({ source: "cdate" }),
			namedDate: null,
			contentDates: [
				makeEntry({
					source: "content",
					blockStart: 5,
					blockEnd: 5,
					summary: "Content"
				})
			],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			pinnedFile: false
		};
		(indexer as any).files = { [PATH]: data };
		(indexer as any).latestLines = { [PATH]: [] };
		(indexer as any).index = {};
	});

	it("updates all same-day records for a file", () => {
		(indexer as any).updateAggregatedEntries(PATH);
		const dayEntries = indexer.index[DAY] ?? [];
		expect(dayEntries.length).toBeGreaterThan(0);

		const content = dayEntries.find((e) => e.file === PATH && e.source === "content");
		expect(content).toBeTruthy();

		const changed = indexer.setEntryReviewState(content as any, "reviewed");
		expect(changed).toBe(true);

		// Both the content record and the anchor record for the same day are updated.
		expect(String((data.contentDates[0] as any).reviewState ?? "draft")).toBe("reviewed");
		expect(String((data.cdate as any).reviewState ?? "draft")).toBe("reviewed");

		(indexer as any).updateAggregatedEntries(PATH);
		const next = indexer.index[DAY] ?? [];
		expect(next.find((e) => e.source === "content")?.reviewState).toBe("reviewed");
		expect(next.find((e) => e.source === "cdate")?.reviewState).toBe("reviewed");
	});
});
