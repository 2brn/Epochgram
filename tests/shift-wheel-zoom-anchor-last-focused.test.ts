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
			getScrollAnchorDayIndex: () => 5
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
		// Active-file Shift+Wheel anchors to opened-record day circle (dayIndex=5 => anchorY 500).
		const expected = 500 * (1 - canvas.scale);
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});

	test("uses scroll-nav anchor fallback when there is no active file", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: false,
			activeFilePath: null,
			pendingScrollNavHighlight: null,
			scrollNavAnchorDayIndex: 2,
			offsetY: 0,
			scale: 1,
			animatingView: false,
			viewInteractionUntil: 0,
			keepHoverUntilPointerMove: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			layouts: [],
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null,
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			getScrollAnchorDayIndex: () => 2
		};

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
		// Anchored to scroll-nav day (index 2 => screenY 2*BASE_SPACING=200 at scale=1, offset=0)
		const expected = 200 * (1 - canvas.scale);
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});

	test("with active file, prefers current scroll-nav day over opened-record date", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: false,
			activeFilePath: "a.md",
			pendingScrollNavHighlight: { dayIndex: 6, entry: { file: "b.md" } },
			scrollNavAnchorEntry: { file: "a.md", date: "2026-05-16" },
			scrollNavAnchorDayIndex: null,
			offsetY: 0,
			scale: 1,
			animatingView: false,
			viewInteractionUntil: 0,
			keepHoverUntilPointerMove: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			layouts: [
				{
					index: 2,
					summaryRects: [],
					summaryHoverRects: [],
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					hasVisibleDate: true
				}
			],
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null,
			// Stale memory points to a different day; policy should ignore this when active file exists.
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			advanceScrollNav: vi.fn(),
			// Current scroll-nav date should win over opened-record date.
			getScrollAnchorDayIndex: () => 6
		};

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
		const expected = 600 * (1 - canvas.scale);
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});

	test("with active file, falls back to opened-record date when only viewport day exists", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			epochsView: false,
			activeFilePath: "a.md",
			pendingScrollNavHighlight: null,
			scrollNavAnchorEntry: { file: "a.md", date: "2026-05-16" },
			scrollNavAnchorDayIndex: null,
			offsetY: 0,
			scale: 1,
			animatingView: false,
			viewInteractionUntil: 0,
			keepHoverUntilPointerMove: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			layouts: [],
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null,
			__shiftZoomLastSummary: { dayIndex: 5, itemIndex: 0, at: 0 },
			clearHover,
			draw,
			requestHoverAnimation,
			canvas: {
				getBoundingClientRect: () => ({ top: 0, height: 800 })
			},
			getToday: () => new Date(2026, 4, 18),
			advanceScrollNav: vi.fn(),
			// This is only the viewport day and should not count as current scroll-nav state.
			getScrollAnchorDayIndex: () => 6
		};

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
		const expected = 200 * (1 - canvas.scale);
		expect(canvas.offsetY).toBeCloseTo(expected, 5);
	});
});
