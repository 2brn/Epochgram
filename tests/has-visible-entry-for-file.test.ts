import { describe, expect, it } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { hasVisibleEntryForFile } from "../src/ui/epoch-canvas/scroll-nav";

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2025-01-01",
	file: overrides.file ?? "note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
	summary: overrides.summary ?? "summary",
	source: overrides.source ?? "content",
	hidden: overrides.hidden,
	pinned: overrides.pinned,
	trackedChange: overrides.trackedChange,
	trackedTime: overrides.trackedTime
});

function makeCanvas(args: {
	height: number;
	layouts: Array<{
		summaryRects: Array<{ y1: number; y2: number; entry: DateEntry }>;
	}>;
}): any {
	return {
		root: {
			getBoundingClientRect: () => ({ height: args.height, width: 1000 })
		},
		layouts: args.layouts.map((l, i) => ({
			index: i,
			y: 0,
			kind: "day",
			dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
			summaryRects: l.summaryRects.map((r, j) => ({
				x1: 0,
				y1: r.y1,
				x2: 0,
				y2: r.y2,
				itemIndex: j,
				entry: r.entry
			}))
		}))
	};
}

describe("hasVisibleEntryForFile", () => {
	it("requires full rect inside padded viewport", () => {
		const entry = makeEntry({ file: "a.md", blockStart: 0, blockEnd: 0 });
		const canvas = makeCanvas({
			height: 1000,
			layouts: [
				{ summaryRects: [{ y1: 100, y2: 900, entry }] },
				{ summaryRects: [{ y1: 99, y2: 200, entry }] },
				{ summaryRects: [{ y1: 800, y2: 901, entry }] }
			]
		});

		expect(hasVisibleEntryForFile(canvas, "a.md")).toBe(true);
	});

	it("uses cursor line to avoid treating other entries as visible", () => {
		const visibleEntry = makeEntry({ file: "a.md", blockStart: 0, blockEnd: 10 });
		const offscreenEntry = makeEntry({ file: "a.md", blockStart: 50, blockEnd: 60 });
		const canvas = makeCanvas({
			height: 1000,
			layouts: [
				{
					summaryRects: [
						{ y1: 150, y2: 200, entry: visibleEntry },
						{ y1: 910, y2: 950, entry: offscreenEntry }
					]
				}
			]
		});

		expect(hasVisibleEntryForFile(canvas, "a.md")).toBe(true);
		expect(hasVisibleEntryForFile(canvas, "a.md", 5)).toBe(true);
		expect(hasVisibleEntryForFile(canvas, "a.md", 55)).toBe(false);
		expect(hasVisibleEntryForFile(canvas, "a.md", 999)).toBe(false);
	});
});
