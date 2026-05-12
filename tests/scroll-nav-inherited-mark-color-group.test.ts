import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2, blockEnd: 2 };
const cEntry = { file: "c.md", source: "content", blockStart: 3, blockEnd: 3, markColor: 1, pinned: true };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn(),
		findLayoutForDate: vi.fn(() => ({})),
		focusSummaryForEntry: vi.fn(() => true),
		dateKeyToDate: vi.fn(() => new Date(0)),
		getDayIndexForDate: vi.fn(() => 5),
		isDateVisible: vi.fn(() => true)
	};
});

const entryHelperMocks = vi.hoisted(() => {
	return {
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		}),
		getEntriesForDate: vi.fn(() => [aEntry, bEntry])
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return entryHelperMocks;
});

import { advanceScrollNav } from "../src/ui/epoch-canvas/scroll-nav";

function makeCanvas(): any {
	const inherited = new Map<string, number>([
		// Same color group: 1 (Red base), 2 (Red shade)
		["a.md", 1],
		["b.md", 2]
	]);
	return {
		plugin: { __epochInheritedMarkIndexByPath: inherited },
		index: { "2020-01-01": [aEntry, bEntry, cEntry] },
		layouts: [
			{
				index: 5,
				y: 0,
				kind: "day",
				dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
				summaryRects: [
					{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: aEntry }
				],
				hasVisibleDate: true
			}
		],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		offsetY: -5 * 48,
		scale: 1,
		activeFilePath: "a.md",
		semanticRelatedScored: null,
		semanticRelatedPaths: null,
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
		scrollNavFile: null
	};
}

describe("scroll-nav inherited mark color group", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("includes same color group files when anchor has inherited mark", () => {
		const canvas = makeCanvas();
		advanceScrollNav(canvas, 1, { wrap: false });
		const calledPaths = entryHelperMocks.pickEntryForFile.mock.calls.map((c: any[]) => c?.[2]);
		expect(calledPaths).toContain("a.md");
		expect(calledPaths).toContain("b.md");
	});

	test("includes explicitly marked files in the same color group", () => {
		const canvas = makeCanvas();
		advanceScrollNav(canvas, 1, { wrap: false });
		const calledPaths = entryHelperMocks.pickEntryForFile.mock.calls.map((c: any[]) => c?.[2]);
		expect(calledPaths).toContain("c.md");
	});

	test("keeps color-group expansion when focused entry is explicitly marked", () => {
		const canvas = makeCanvas();
		// Simulate focus/hover on an explicitly marked entry.
		canvas.hoverSummary = { dayIndex: 5, itemIndex: 0 };
		canvas.animSummary = { dayIndex: 5, itemIndex: 0 };
		canvas.layouts[0].summaryRects[0].entry = cEntry;
		advanceScrollNav(canvas, 1, { wrap: false });
		const calledPaths = entryHelperMocks.pickEntryForFile.mock.calls.map((c: any[]) => c?.[2]);
		expect(calledPaths).toContain("a.md");
		expect(calledPaths).toContain("b.md");
		expect(calledPaths).toContain("c.md");
	});
});
