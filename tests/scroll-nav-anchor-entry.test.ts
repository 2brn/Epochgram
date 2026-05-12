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
		getEntriesForDate: vi.fn(() => [bEntry, aEntry]),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		})
	};
});

import { advanceScrollNav } from "../src/ui/epoch-canvas/scroll-nav";
import { focusDate } from "../src/ui/epoch-canvas-focus";
import { navigateToEntryTarget } from "../src/ui/epoch-canvas/scroll-nav";

function makeCanvas(): any {
	return {
		plugin: {
			__epochInheritedMarkSourceByPath: new Map<string, string>(),
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
		semanticRelatedScored: [{ path: "b.md", score: 0.9 }],
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
		semanticRelatedBasePath: "a.md",
		scrollNavAnchorEntry: bEntry,
		scrollNavAnchorDayIndex: 5
	};
}

describe("scroll nav anchor entry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("records forced cursor position for external follow-focus", () => {
		const canvas = makeCanvas();
		navigateToEntryTarget(canvas as any, { kind: "entry", date: new Date(0), entry: bEntry as any });
		expect((canvas as any).__forcedActiveFileCursorPath).toBe("b.md");
		expect((canvas as any).__forcedActiveFileCursorLine).toBe(2);
		expect(typeof (canvas as any).__forcedActiveFileCursorUntil).toBe("number");
	});

	test("anchors to last clicked/startup entry when hover is empty", () => {
		const canvas = makeCanvas();
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
	});
});
