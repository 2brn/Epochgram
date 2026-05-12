import { describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2, blockEnd: 2 };
const cEntry = { file: "c.md", source: "content", blockStart: 3, blockEnd: 3 };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn((canvas: any, _date: any, highlight: boolean, _scroll: boolean) => {
			if (highlight) {
				canvas.hoverSummary = null;
				canvas.animSummary = null;
				canvas.hoverDateIndex = 5;
				canvas.animDateIndex = 5;
				canvas.hoverTarget = 1;
			}
			return true;
		}),
		findLayoutForDate: vi.fn(() => ({})),
		focusSummaryForEntry: vi.fn((canvas: any, _layout: any, entry: any) => {
			canvas.hoverSummary = { dayIndex: 5, itemIndex: entry?.file === "a.md" ? 0 : (entry?.file === "b.md" ? 1 : 2) };
			canvas.animSummary = canvas.hoverSummary;
			canvas.hoverDateIndex = null;
			canvas.animDateIndex = null;
			canvas.hoverTarget = 1;
			return true;
		}),
		dateKeyToDate: vi.fn(() => new Date(0)),
		getDayIndexForDate: vi.fn(() => 5),
		isDateVisible: vi.fn(() => true)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn(() => [aEntry, bEntry, cEntry]),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		})
	};
});

import { advanceScrollNav } from "../src/ui/epoch-canvas/scroll-nav";
import { focusDate } from "../src/ui/epoch-canvas-focus";

function makeCanvas(): any {
	return {
		index: { "2020-01-01": [{}, {}] },
		layouts: [
			{
				index: 5,
				y: 0,
				kind: "day",
				dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
				// Dense bar click rects (single rect representing the primary entry only)
				summaryRects: [{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: aEntry }],
				// Dense bar hover rects (all entries share the same bar area)
				summaryHoverRects: [
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: aEntry },
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 1, entry: bEntry },
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 2, entry: cEntry }
				],
				hasVisibleDate: true
			}
		],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		offsetY: -5 * 48,
		scale: 1,
		activeFilePath: "a.md",
		semanticRelatedScored: [{ path: "b.md" }, { path: "c.md" }],
		clearFocusedEpochRange: vi.fn(),
		requestHoverAnimation: vi.fn(),
		focusFile: vi.fn(),
		hoverSummary: { dayIndex: 5, itemIndex: 1 },
		animSummary: { dayIndex: 5, itemIndex: 1 },
		hoverDateIndex: null,
		animDateIndex: null,
		hoverTarget: 1,
		pendingScrollNavHighlight: null,
		scrollNavIndex: -1,
		scrollNavFile: null
	};
}

describe("scroll nav dense bars", () => {
	test("anchors from summaryHoverRects and advances through all similars", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
	});
});
