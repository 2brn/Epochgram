import { describe, expect, it } from "vitest";
import { findFirstRelatedEntryForEpochRange, listRelatedEntriesForEpochRange } from "../src/ui/epoch-canvas/epochs-view";
import { pickNextEpochEntryFromRange } from "../src/ui/epoch-canvas-events/interactions";

function makeCanvas(index: Record<string, any[]>): any {
	return {
		index,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		showPropDates: true,
		epochsView: false,
		searchQuery: ""
	};
}

describe("epoch open target selection", () => {
	it("prefers the newest date in the epoch range", () => {
		const canvas = makeCanvas({
			"2025-01-02": [
				{
					date: "2025-01-02",
					file: "Old.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Old summary"
				}
			],
			"2025-01-03": [
				{
					date: "2025-01-03",
					file: "New.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "New summary"
				}
			]
		});

		const picked = findFirstRelatedEntryForEpochRange(canvas, "2025-01-02", "2025-01-03");
		expect(picked?.file).toBe("New.md");
	});

	it("skips synthetic pinned-today clone and uses next entry", () => {
		const canvas = makeCanvas({
			"2025-01-02": [
				{
					date: "2025-01-02",
					originalDate: "2025-01-01",
					pinned: true,
					file: "Pinned.md",
					blockStart: 0,
					blockEnd: 0,
					source: "cdate",
					summary: "Pinned summary"
				},
				{
					date: "2025-01-02",
					file: "Real.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Real summary"
				}
			]
		});

		const picked = findFirstRelatedEntryForEpochRange(canvas, "2025-01-02", "2025-01-02");
		expect(picked?.file).toBe("Real.md");
	});

	it("prefers anchor over content over tracked for the same date", () => {
		const canvas = makeCanvas({
			"2025-01-02": [
				{
					date: "2025-01-02",
					file: "Tracked.md",
					blockStart: 0,
					blockEnd: 0,
					source: "tracked",
					summary: "Tracked summary"
				},
				{
					date: "2025-01-02",
					file: "Content.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Content summary"
				},
				{
					date: "2025-01-02",
					file: "Anchor.md",
					blockStart: 0,
					blockEnd: 0,
					source: "cdate",
					summary: "Anchor summary"
				}
			]
		});

		const picked = findFirstRelatedEntryForEpochRange(canvas, "2025-01-02", "2025-01-02");
		expect(picked?.file).toBe("Anchor.md");
	});

	it("falls back to content when no anchor exists", () => {
		const canvas = makeCanvas({
			"2025-01-02": [
				{
					date: "2025-01-02",
					file: "Tracked.md",
					blockStart: 0,
					blockEnd: 0,
					source: "tracked",
					summary: "Tracked summary"
				},
				{
					date: "2025-01-02",
					file: "Content.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Content summary"
				}
			]
		});

		const picked = findFirstRelatedEntryForEpochRange(canvas, "2025-01-02", "2025-01-02");
		expect(picked?.file).toBe("Content.md");
	});

	it("continues to next date when a date only has a synthetic pinned-today clone", () => {
		const canvas = makeCanvas({
			"2025-01-02": [
				{
					date: "2025-01-02",
					originalDate: "2025-01-01",
					pinned: true,
					file: "Pinned.md",
					blockStart: 0,
					blockEnd: 0,
					source: "cdate",
					summary: "Pinned summary"
				}
			],
			"2025-01-03": [
				{
					date: "2025-01-03",
					file: "Real.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Real summary"
				}
			]
		});

		const picked = findFirstRelatedEntryForEpochRange(canvas, "2025-01-02", "2025-01-03");
		expect(picked?.file).toBe("Real.md");
	});

	it("returns all related records in priority order for epoch range", () => {
		const canvas = makeCanvas({
			"2025-01-03": [
				{
					date: "2025-01-03",
					file: "Tracked.md",
					blockStart: 0,
					blockEnd: 0,
					source: "tracked",
					summary: "Tracked summary"
				},
				{
					date: "2025-01-03",
					file: "Content.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Content summary"
				},
				{
					date: "2025-01-03",
					file: "Anchor.md",
					blockStart: 0,
					blockEnd: 0,
					source: "cdate",
					summary: "Anchor summary"
				}
			],
			"2025-01-02": [
				{
					date: "2025-01-02",
					file: "Older.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "Older summary"
				}
			]
		});

		const ordered = listRelatedEntriesForEpochRange(canvas, "2025-01-02", "2025-01-03");
		expect(ordered.map((e) => e.file)).toEqual(["Anchor.md", "Content.md", "Tracked.md", "Older.md"]);
	});

	it("cycles epoch open target and resets counter when switching epoch", () => {
		const canvas = makeCanvas({
			"2025-01-03": [
				{
					date: "2025-01-03",
					file: "A.md",
					blockStart: 0,
					blockEnd: 0,
					source: "cdate",
					summary: "A"
				},
				{
					date: "2025-01-03",
					file: "B.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "B"
				}
			],
			"2025-01-02": [
				{
					date: "2025-01-02",
					file: "C.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "C"
				}
			],
			"2025-01-01": [
				{
					date: "2025-01-01",
					file: "D.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "D"
				}
			]
		});
		const state: any = {};

		expect(pickNextEpochEntryFromRange(canvas as any, "2025-01-02", "2025-01-03", state)?.file).toBe("A.md");
		expect(pickNextEpochEntryFromRange(canvas as any, "2025-01-02", "2025-01-03", state)?.file).toBe("B.md");
		expect(pickNextEpochEntryFromRange(canvas as any, "2025-01-02", "2025-01-03", state)?.file).toBe("C.md");
		expect(pickNextEpochEntryFromRange(canvas as any, "2025-01-02", "2025-01-03", state)?.file).toBe("A.md");

		// Switching to a different epoch range should reset cursor and start from its top-priority record.
		expect(pickNextEpochEntryFromRange(canvas as any, "2025-01-01", "2025-01-01", state)?.file).toBe("D.md");
	});
});
