import { beforeEach, describe, expect, test, vi } from "vitest";

const entry0 = { file: "a.md", source: "content", blockStart: 0, blockEnd: 0 };
const entry10 = { file: "a.md", source: "content", blockStart: 10, blockEnd: 10 };
const entry11 = { file: "a.md", source: "content", blockStart: 11, blockEnd: 11 };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn(),
		findLayoutForDate: vi.fn(() => ({})),
		focusSummaryForEntry: vi.fn(() => true),
		// Encode dayIndex directly into Date.getTime().
		dateKeyToDate: vi.fn((key: string) => {
			const m = String(key || "").match(/^d(\d+)$/);
			if (!m) return null;
			return new Date(Number(m[1]));
		}),
		getDayIndexForDate: vi.fn((_canvas: any, date: Date) => {
			return Number(date?.getTime?.() ?? 0);
		}),
		isDateVisible: vi.fn(() => true)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn((_canvas: any, date: Date) => {
			const idx = Number(date?.getTime?.() ?? 0);
			if (idx === 0) return [entry0];
			if (idx === 10) return [entry10];
			if (idx === 11) return [entry11];
			return [];
		}),
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
		index: {
			d0: [entry0],
			d10: [entry10],
			d11: [entry11]
		},
		layouts: [],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		// Put dayIndex 10 at the center of the viewport (BASE_SPACING is 90).
		offsetY: 400 - 10 * 90,
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
		scrollNavFile: null,
		__scrollNavAnchorMode: "center"
	};
}

describe("scroll-nav initial anchor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("when nothing is hovered, direction +1 picks the next target below center (not newest)", () => {
		const canvas = makeCanvas();
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		expect((focusDate as any).mock.calls.length).toBe(1);
		expect((focusDate as any).mock.calls[0][1]).toBeInstanceOf(Date);
		expect(Number(((focusDate as any).mock.calls[0][1] as Date).getTime())).toBe(10);
	});
});
