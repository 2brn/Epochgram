import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2 };
const cEntry = { file: "c.md", source: "content", blockStart: 3 };

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
			// Simulate an entry that isn't currently renderable (hidden under +n).
			if (entry?.file === "b.md") return false;
			// On success, simulate the real helper updating hover so subsequent steps
			// behave like the app.
			if (entry?.file === "a.md") {
				canvas.hoverSummary = { dayIndex: 5, itemIndex: 0 };
				canvas.animSummary = canvas.hoverSummary;
				canvas.hoverDateIndex = null;
				canvas.animDateIndex = null;
				canvas.hoverTarget = 1;
				return true;
			}
			if (entry?.file === "c.md") {
				canvas.hoverSummary = { dayIndex: 5, itemIndex: 1 };
				canvas.animSummary = canvas.hoverSummary;
				canvas.hoverDateIndex = null;
				canvas.animDateIndex = null;
				canvas.hoverTarget = 1;
				return true;
			}
			return !!entry;
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
		index: { "2020-01-01": [{}, {}, {}] },
		layouts: [
			{
				index: 5,
				y: 0,
				kind: "day",
				dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
				// Note: bEntry intentionally has no rect (hidden under +n).
				summaryRects: [
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: aEntry },
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 1, entry: cEntry }
				],
				hasVisibleDate: true
			}
		],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		offsetY: -5 * 48,
		scale: 1,
		activeFilePath: "a.md",
		semanticRelatedScored: [{ path: "b.md", score: 0.9 }, { path: "c.md", score: 0.8 }],
		clearFocusedEpochRange: vi.fn(),
		requestHoverAnimation: vi.fn(),
		focusFile: vi.fn(),
		hoverSummary: { dayIndex: 5, itemIndex: 0 },
		animSummary: { dayIndex: 5, itemIndex: 0 },
		hoverDateIndex: null,
		animDateIndex: null,
		hoverTarget: 1,
		pendingScrollNavHighlight: null,
		scrollNavIndex: -1,
		scrollNavFile: null,
		scrollNavAnchorEntry: null,
		scrollNavAnchorDayIndex: null
	};
}

describe("scroll nav hidden target anchoring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("continues from hidden target (does not re-anchor to stale hover)", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
		expect(canvas.scrollNavAnchorDayIndex).toBe(5);

		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(false);
		expect((focusDate as any).mock.calls.length).toBe(1);
	});

	test("ignores hover when hovered entry cannot be resolved", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);

		// Simulate a hover state that can't be resolved to an entry in the current layout.
		// Similar-nav is date-only, so this should not matter.
		canvas.hoverSummary = { dayIndex: 5, itemIndex: 999 };
		canvas.animSummary = canvas.hoverSummary;
		canvas.hoverDateIndex = null;
		canvas.animDateIndex = null;
		canvas.hoverTarget = 0;

		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(2);
	});
});
