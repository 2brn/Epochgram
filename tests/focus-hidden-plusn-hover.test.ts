import { describe, expect, it } from "vitest";

import type { DateEntry } from "../src/indexer/types";
import { focusSummaryForEntry } from "../src/ui/epoch-canvas-focus";

function makeEntry(file: string, blockStart: number): DateEntry {
	return {
		date: "2025-01-01",
		file,
		blockStart,
		blockEnd: blockStart,
		summary: "x",
		source: "cdate"
	} as any;
}

function makeCanvas(indexKey: string, entries: DateEntry[]): any {
	return {
		scale: 1,
		offsetY: 0,
		targetScale: 1,
		targetOffsetY: 0,
		animatingView: false,
		pendingVisibilityDraw: false,
		scheduleVisibilityCheck: () => void 0,
		cancelFocusClear: () => void 0,
		focusClearHandle: null,
		clearHover: () => {
			// minimal behavior for this test
		},
		clearSummaryHover: () => void 0,
		requestHoverAnimation: () => void 0,
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		getTodayOffset: () => 0,
		getToday: () => new Date(2025, 0, 1),
		getDateForIndex: () => new Date(2025, 0, 1),
		index: { [indexKey]: entries },
		layouts: [],
		hoverDateIndex: null,
		hoverSummary: null,
		hoverTarget: 0,
		hoverAnim: 0,
		animDateIndex: null,
		animSummary: null,
		keepHoverUntilPointerMove: false
	};
}

describe("focusSummaryForEntry + compact (+n) hidden target", () => {
	it("hovers the last visible row when the target entry is hidden", () => {
		const a = makeEntry("a.md", 1);
		const b = makeEntry("b.md", 2);
		const c = makeEntry("c.md", 3);
		const key = "2025-01-01";
		const canvas = makeCanvas(key, [a, b, c]);

		const layout: any = {
			index: 0,
			summaryRects: [
				{ x1: 0, y1: 10, x2: 100, y2: 20, itemIndex: 0, entry: a },
				{ x1: 0, y1: 30, x2: 100, y2: 40, itemIndex: 1, entry: b }
			]
		};

		const ok = focusSummaryForEntry(canvas, layout, c, true);
		expect(ok).toBe(true);
		expect(canvas.hoverSummary).toEqual({ dayIndex: 0, itemIndex: 1 });
	});
});
