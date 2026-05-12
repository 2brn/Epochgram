import { describe, expect, it, vi } from "vitest";
import { focusSummaryForEntry } from "../src/ui/epoch-canvas-focus";

function makeCanvas(overrides: Partial<any> = {}): any {
	const clearHover = vi.fn();
	const canvas: any = {
		isPointerDeviceEvent: () => false,
		cancelFocusClear: () => {},
		requestHoverAnimation: () => {},
		getTodayOffset: () => 300,
		scale: 1,
		offsetY: 0,
		animatingView: false,
		targetScale: 1,
		targetOffsetY: 0,
		getToday: () => new Date("2026-02-06T00:00:00.000Z"),
		getDateForIndex: () => new Date("2026-02-06T00:00:00.000Z"),
		clearHover,
		layouts: [],
		root: { getBoundingClientRect: () => ({ height: 800, width: 400, top: 0, left: 0 }) },
		...overrides
	};
	return { canvas, clearHover };
}

describe("mobile focus hover", () => {
	it("does not clear hover as a side-effect when useHoverHighlight=false on mobile", () => {
		const entry = { file: "a.md", source: "namedate", blockStart: 1, blockEnd: 2 } as any;
		const layout = {
			index: 0,
			summaryRects: [
				{ x1: 0, y1: 0, x2: 100, y2: 20, itemIndex: 0, entry }
			]
		} as any;
		const { canvas, clearHover } = makeCanvas({ layouts: [layout] });
		const ok = focusSummaryForEntry(canvas, layout, entry, false);
		expect(ok).toBe(true);
		expect(clearHover).not.toHaveBeenCalled();
	});
});
