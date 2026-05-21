import { describe, expect, test, vi } from "vitest";

import { handleWheel } from "../src/ui/epoch-canvas-events/wheel";
import { clampTimelineOffsetToBounds } from "../src/ui/epoch-canvas/viewport-limits";

describe("wheel pan resets scroll-nav target", () => {
	test("wheel direction change interrupts in-flight wheel pan", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();

		const canvas: any = {
			epochsView: false,
			animatingView: false,
			viewInteractionUntil: 0,
			pendingScrollNavHighlight: null,
			scrollNavIndex: -1,
			scrollNavAnchorEntry: null,
			scrollNavAnchorDayIndex: null,
			offsetY: 0,
			scale: 1,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ top: 0, height: 800 }) },
			root: { getBoundingClientRect: () => ({ height: 800 }) },
			getToday: () => new Date(2026, 4, 21),
			layouts: [],
			clearHover: vi.fn(),
			draw,
			requestHoverAnimation,
			advanceScrollNav: vi.fn(),
			animatingWheelPan: true,
			targetOffsetY: -500,
			targetScale: 1
		};

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: -120,
			deltaX: 0,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);

		expect(canvas.targetOffsetY).toBe(
			clampTimelineOffsetToBounds({
				offsetY: 120,
				scale: 1,
				viewportHeight: 800,
				today: new Date(2026, 4, 21)
			})
		);
		expect(canvas.animatingWheelPan).toBe(true);
		expect(canvas.offsetY).toBe(0);
	});

	test("non-alt wheel pan clears scroll-nav anchor and index", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();

		const canvas: any = {
			epochsView: false,
			animatingView: true,
			viewInteractionUntil: 0,
			pendingScrollNavHighlight: { dayIndex: 1, entry: { file: "A.md" }, date: new Date(), attempts: 0, startedAt: 0 },
			scrollNavIndex: 7,
			scrollNavAnchorEntry: { file: "A.md" },
			scrollNavAnchorDayIndex: 5,
			offsetY: 10,
			scale: 1,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ top: 0, height: 800 }) },
			root: { getBoundingClientRect: () => ({ height: 800 }) },
			getToday: () => new Date(2026, 4, 21),
			layouts: [],
			clearHover: vi.fn(),
			draw,
			requestHoverAnimation,
			advanceScrollNav: vi.fn()
		};

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 120,
			deltaX: 0,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);

		expect(canvas.scrollNavIndex).toBe(-1);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(canvas.scrollNavAnchorDayIndex).toBe(null);
		expect(canvas.pendingScrollNavHighlight).toBe(null);
		expect(canvas.targetOffsetY).toBe(
			clampTimelineOffsetToBounds({
				offsetY: 10 - 120,
				scale: 1,
				viewportHeight: 800,
				today: new Date(2026, 4, 21)
			})
		);
		expect(canvas.offsetY).toBe(10);
		expect(canvas.animatingWheelPan).toBe(true);
		expect(canvas.animatingView).toBeFalsy();
		expect(canvas.suppressHoverUntilPointerMove).toBe(true);
		expect(draw).toHaveBeenCalledTimes(1);
		expect(requestHoverAnimation).toHaveBeenCalledTimes(1);
	});

	test("ctrl+wheel zoom does not reset scroll-nav target", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();

		const canvas: any = {
			epochsView: false,
			animatingView: true,
			viewInteractionUntil: 0,
			pendingScrollNavHighlight: null,
			scrollNavIndex: 7,
			scrollNavAnchorEntry: { file: "A.md" },
			scrollNavAnchorDayIndex: 5,
			offsetY: 10,
			scale: 1,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ top: 0, height: 800 }) },
			root: { getBoundingClientRect: () => ({ height: 800 }) },
			layouts: [],
			clearHover: vi.fn(),
			draw,
			requestHoverAnimation,
			advanceScrollNav: vi.fn(),
			hoverSummary: null,
			animSummary: null,
			hoverDateIndex: null,
			animDateIndex: null
		};

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 120,
			deltaX: 0,
			altKey: false,
			ctrlKey: true,
			metaKey: false,
			shiftKey: false
		} as any);

		expect(canvas.scrollNavIndex).toBe(7);
		expect(canvas.scrollNavAnchorEntry).toEqual({ file: "A.md" });
		expect(canvas.scrollNavAnchorDayIndex).toBe(5);
	});
});
