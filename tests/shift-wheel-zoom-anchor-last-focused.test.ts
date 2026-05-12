import { describe, expect, test, vi } from "vitest";

import { handleWheel } from "../src/ui/epoch-canvas-events/wheel";

describe("shift+wheel zoom anchor (last focused)", () => {
	test("anchors to last focused summary when hover is cleared", () => {
		const layoutShiftAfterZoom = 30;
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: false,
			pendingScrollNavHighlight: null,
			offsetY: 0,
			scale: 1,
			animatingView: false,
			viewInteractionUntil: 0,
			keepHoverUntilPointerMove: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			layouts: [
				{
					index: 5,
					summaryRects: [{ x1: 0, y1: 100, x2: 0, y2: 200, itemIndex: 0, entry: { file: "a.md" } }],
					summaryHoverRects: [{ x1: 0, y1: 100, x2: 0, y2: 200, itemIndex: 0, entry: { file: "a.md" } }],
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					hasVisibleDate: true
				}
			],
			// Hover cleared (e.g., user released Alt / pointer moved away)
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null,
			hoverTarget: 0,
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => null
		};

		draw.mockImplementation(() => {
			const extra = canvas.scale > 1 ? layoutShiftAfterZoom : 0;
			const centerY = 150 * canvas.scale + canvas.offsetY + extra;
			canvas.layouts[0].summaryRects[0].y1 = centerY - 50;
			canvas.layouts[0].summaryRects[0].y2 = centerY + 50;
			canvas.layouts[0].summaryHoverRects[0].y1 = centerY - 50;
			canvas.layouts[0].summaryHoverRects[0].y2 = centerY + 50;
		});

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: -100,
			deltaX: 0,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
			metaKey: false
		} as any);

		expect(canvas.scale).toBeGreaterThan(1);
		// anchor should be the last focused summary center (150), not pointer (10)
		const expected = 150 * (1 - canvas.scale) - layoutShiftAfterZoom;
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});
});
