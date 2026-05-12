import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn(() => true),
		findLayoutForDate: vi.fn(() => ({})),
		focusSummaryForEntry: vi.fn(() => true),
		dateKeyToDate: vi.fn(() => new Date(0)),
		getDayIndexForDate: vi.fn(() => 5),
		isDateVisible: vi.fn(() => true)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn(() => [aEntry]),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		})
	};
});

import { advanceScrollNav } from "../src/ui/epoch-canvas/scroll-nav";
import { focusDate, focusSummaryForEntry } from "../src/ui/epoch-canvas-focus";

function makeCanvas(): any {
	return {
		plugin: {
			__epochInheritedMarkSourceByPath: new Map<string, string>(),
			__epochInheritedMarkIndexByPath: new Map<string, number>()
		},
		index: { "2020-01-01": [aEntry] },
		layouts: [
			{
				index: 5,
				y: 0,
				kind: "day",
				dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
				summaryRects: [{ x1: 0, y1: 0, x2: 0, y2: 0, itemIndex: 0, entry: aEntry }],
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

describe("scroll nav single target", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("highlights date (not record) when only one target exists", () => {
		const canvas = makeCanvas();
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
		expect((focusSummaryForEntry as any).mock.calls.length).toBe(0);
	});
});
