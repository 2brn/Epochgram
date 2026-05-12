import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2 };

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
			// Simulate the real helper setting hover state so no-wrap boundary navigation
			// behaves like it does in the app.
			canvas.hoverSummary = { dayIndex: 5, itemIndex: entry?.file === "b.md" ? 0 : 1 };
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
		getEntriesForDate: vi.fn(() => [bEntry, aEntry]),
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
				summaryRects: [
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: bEntry },
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 1, entry: aEntry }
				],
				hasVisibleDate: true
			}
		],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		offsetY: -5 * 48,
		scale: 1,
		activeFilePath: "a.md",
		semanticRelatedScored: [{ path: "b.md" }],
		clearFocusedEpochRange: vi.fn(),
		requestHoverAnimation: vi.fn(),
		focusFile: vi.fn(),
		hoverSummary: null,
		animSummary: null,
		hoverDateIndex: null,
		animDateIndex: null,
		hoverTarget: 0,
		pendingScrollNavHighlight: null,
		scrollNavIndex: -1,
		scrollNavFile: null
	};
}

describe("similar navigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("does not skip multiple targets on same day", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
		expect((focusDate as any).mock.calls[0][3]).toBe(true);

		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(false);
		expect((focusDate as any).mock.calls.length).toBe(1);
	});

	test("reverse direction from date focus does not skip same-day targets", () => {
		const canvas = makeCanvas();
		// Simulate the user hovering the date marker (not a specific summary item).
		canvas.hoverDateIndex = 5;
		canvas.animDateIndex = 5;
		canvas.hoverSummary = null;
		canvas.animSummary = null;
		canvas.hoverTarget = 1;

		const ok1 = advanceScrollNav(canvas, -1, { wrap: false });
		expect(ok1).toBe(false);
		expect((focusDate as any).mock.calls.length).toBe(0);
	});

	test("does not cycle when reaching the end", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(false);

		const idxBefore = canvas.scrollNavIndex;
		const ok3 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok3).toBe(false);
		expect(canvas.scrollNavIndex).toBe(idxBefore);
	});

	test("re-highlights boundary when hover is empty", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(false);
		// Simulate losing hover (e.g. OS pointer jitter / fast wheel input).
		canvas.hoverSummary = null;
		canvas.animSummary = null;
		canvas.hoverDateIndex = null;
		canvas.animDateIndex = null;
		canvas.hoverTarget = 0;

		const ok3 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok3).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(2);
	});

	test("re-highlights boundary when hover is animating out", () => {
		const canvas = makeCanvas();

		const ok1 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok1).toBe(true);
		const ok2 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok2).toBe(false);

		// Simulate a hover-out animation in progress (animSummary still set) but no active hover target.
		canvas.hoverSummary = null;
		canvas.hoverTarget = 0;
		canvas.animSummary = { dayIndex: 5, itemIndex: 1 };
		canvas.hoverDateIndex = null;
		canvas.animDateIndex = 5;

		const ok3 = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok3).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(2);
	});
});
