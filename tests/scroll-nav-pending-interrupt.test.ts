import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2, blockEnd: 2 };

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
			// Simulate setting hover to the focused entry (when highlighting succeeds).
			canvas.hoverSummary = { dayIndex: 5, itemIndex: entry?.file === "a.md" ? 1 : 0 };
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
		hoverSummary: { dayIndex: 5, itemIndex: 0 }, // stale hover (b)
		animSummary: { dayIndex: 5, itemIndex: 0 },
		hoverDateIndex: null,
		animDateIndex: null,
		hoverTarget: 1,
		pendingScrollNavHighlight: null,
		scrollNavIndex: 1,
		scrollNavFile: "a.md"
	};
}

describe("scroll-nav pending interrupt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("uses pending target as anchor even if hover is stale", () => {
		const canvas = makeCanvas();
		// Simulate we already navigated to 'a' but highlight is still pending.
		canvas.pendingScrollNavHighlight = { dayIndex: 5, entry: aEntry, date: new Date(0), attempts: 0, startedAt: 0 };

		// Going forward from the last target should be a no-op.
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(false);
		expect((focusDate as any).mock.calls.length).toBe(0);
	});

	test("direction change overrides in-flight pending immediately", () => {
		const canvas = makeCanvas();
		canvas.pendingScrollNavHighlight = { dayIndex: 5, entry: aEntry, date: new Date(0), attempts: 0, startedAt: 0 };

		const ok = advanceScrollNav(canvas, -1, { wrap: false });
		expect(ok).toBe(false);
		expect((focusDate as any).mock.calls.length).toBe(0);
	});
});
