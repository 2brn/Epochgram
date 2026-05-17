import { describe, expect, test, vi } from "vitest";

import { handleWheel } from "../src/ui/epoch-canvas-events/wheel";

describe("shift+wheel zoom anchor", () => {
	test("anchors to hovered summary rect center", () => {
		const baseWorldCenterY = 150;
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
					// Dense/placeholder/normal all ultimately expose hover rects; we just need y1/y2.
					summaryRects: [{ x1: 0, y1: 100, x2: 0, y2: 200, itemIndex: 0, entry: { file: "a.md" } }],
					summaryHoverRects: [{ x1: 0, y1: 100, x2: 0, y2: 200, itemIndex: 0, entry: { file: "a.md" } }],
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					hasVisibleDate: true
				}
			],
			hoverSummary: { dayIndex: 5, itemIndex: 0 },
			animSummary: { dayIndex: 5, itemIndex: 0 },
			hoverDateIndex: null,
			animDateIndex: null,
			hoverTarget: 1,
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => null
		};

		// Simulate a layout model where the hovered item's screen position is not purely
		// linear with scale/offset (e.g., packing/mode transitions). This is the key bug:
		// without a second-pass correction, the hovered item will drift by this shift.
		draw.mockImplementation(() => {
			const extra = canvas.scale > 1 ? layoutShiftAfterZoom : 0;
			const centerY = baseWorldCenterY * canvas.scale + canvas.offsetY + extra;
			canvas.layouts[0].summaryRects[0].y1 = centerY - 50;
			canvas.layouts[0].summaryRects[0].y2 = centerY + 50;
			canvas.layouts[0].summaryHoverRects[0].y1 = centerY - 50;
			canvas.layouts[0].summaryHoverRects[0].y2 = centerY + 50;
		});

		// Put the pointer somewhere else so we can detect whether the code anchors to hover
		// rect center (150) or pointer position (10).
		const ev: any = {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: -100,
			deltaX: 0,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
			metaKey: false
		};

		handleWheel(canvas, ev);

		// With anchorY=150 and prevScale=1, the first-pass linear zoom math would
		// yield offsetY=150*(1-newScale). But if the layout shifts by +30 after zoom,
		// we also need a -30 correction to keep the hovered item pinned.
		expect(canvas.scale).toBeGreaterThan(1);
		const expected = 150 * (1 - canvas.scale) - layoutShiftAfterZoom;
		expect(canvas.offsetY).toBeCloseTo(expected, 5);

		expect(clearHover).toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
		expect(requestHoverAnimation).toHaveBeenCalled();
	});

	test("zooms in epochs view on shift+wheel", () => {
		const baseWorldCenterY = 150;
		const layoutShiftAfterZoom = 30;
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: true,
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
			hoverSummary: { dayIndex: 5, itemIndex: 0 },
			animSummary: { dayIndex: 5, itemIndex: 0 },
			hoverDateIndex: null,
			animDateIndex: null,
			hoverTarget: 1,
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
			const centerY = baseWorldCenterY * canvas.scale + canvas.offsetY + extra;
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
		expect((canvas as any).animatingWheelPan).not.toBe(true);
		expect(clearHover).toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
		expect(requestHoverAnimation).toHaveBeenCalled();
	});
});
