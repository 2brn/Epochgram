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
			activeFilePath: "a.md",
			pendingScrollNavHighlight: null,
			scrollNavAnchorEntry: { file: "a.md", date: "2026-05-13" },
			scrollNavAnchorDayIndex: 5,
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
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			hoverTarget: 1,
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => 5
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

		// Active-file Shift+Wheel now anchors to opened-record day circle.
		// For dayIndex=5, anchorY is 500 at scale=1/offset=0.
		expect(canvas.scale).toBeGreaterThan(1);
		const expected = 500 * (1 - canvas.scale);
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
			activeFilePath: "a.md",
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
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			hoverTarget: 1,
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => 5
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

	test("keeps anchor when summary rect disappears at deep zoom-out", () => {
		const layoutShiftAfterZoom = 30;
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: false,
			activeFilePath: "a.md",
			pendingScrollNavHighlight: null,
			scrollNavAnchorEntry: { file: "a.md", date: "2026-05-13" },
			scrollNavAnchorDayIndex: 5,
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
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null,
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			hoverTarget: 1,
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => 5
		};

		draw.mockImplementation(() => {
			const centerY = 150 * canvas.scale + canvas.offsetY + layoutShiftAfterZoom;
			canvas.layouts[0].dateRect.y1 = centerY - 10;
			canvas.layouts[0].dateRect.y2 = centerY + 10;
			// Simulate dense/zoomed-out mode where summary rects are no longer rendered.
			canvas.layouts[0].summaryRects = [];
			canvas.layouts[0].summaryHoverRects = [];
		});

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 1000,
			deltaX: 0,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
			metaKey: false
		} as any);

		expect(canvas.scale).toBeLessThan(1);
		const expected = 500 * (1 - canvas.scale);
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});
});
