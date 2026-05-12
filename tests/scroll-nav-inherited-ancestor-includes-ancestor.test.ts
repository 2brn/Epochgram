import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "A.md", source: "content", blockStart: 1 };
const cEntry = { file: "C.md", source: "content", blockStart: 2 };

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
		focusSummaryForEntry: vi.fn((_canvas: any, _layout: any, entry: any) => {
			return !!entry;
		}),
		dateKeyToDate: vi.fn(() => new Date(0)),
		getDayIndexForDate: vi.fn(() => 5),
		isDateVisible: vi.fn(() => true)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn(() => [aEntry, cEntry]),
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
		plugin: {
			__epochInheritedMarkSourceByPath: new Map<string, string>([["C.md", "A.md"]]),
			__epochInheritedMarkIndexByPath: new Map<string, number>()
		},
		index: { "2020-01-01": [{}, {}] },
		layouts: [
			{
				index: 5,
				y: 0,
				kind: "day",
				dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
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
		activeFilePath: "C.md",
		semanticRelatedScored: null,
		semanticRelatedPaths: null,
		semanticRelatedBasePath: "A.md",
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
		scrollNavFile: null,
		scrollNavAnchorEntry: cEntry,
		scrollNavAnchorDayIndex: 5
	};
}

describe("scroll nav inherited ancestor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("includes ancestor as a navigable target", () => {
		const canvas = makeCanvas();
		const ok = advanceScrollNav(canvas, -1, { wrap: false });
		expect(ok).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
	});
});
