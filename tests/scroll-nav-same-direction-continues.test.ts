import { describe, expect, test, vi } from "vitest";

import { navigateToEntryTarget } from "../src/ui/epoch-canvas/scroll-nav";
import { FOCUS_ANCHOR_RATIO } from "../src/ui/epoch-canvas-constants";

describe("scroll-nav same-direction continuation", () => {
	test("retargets scroll even if target date is visible while animating", () => {
		const requestHoverAnimation = vi.fn();
		const clearFocusedEpochRange = vi.fn();

		const today = new Date(2026, 0, 19);
		const height = 800;

		const canvas: any = {
			// Focus internals
			scale: 1,
			offsetY: 0,
			targetScale: 1,
			targetOffsetY: 123,
			animatingView: true,
			root: { getBoundingClientRect: () => ({ height }) },
			getToday: () => today,
			layouts: [],
			pendingVisibilityDraw: false,
			scheduleVisibilityCheck: vi.fn(),
			cancelFocusClear: vi.fn(),
			focusClearHandle: null,
			clearHover: vi.fn(),
			requestHoverAnimation,
			clearSummaryHover: vi.fn(),
			keepHoverUntilPointerMove: false,

			// Scroll-nav internals
			pendingScrollNavHighlight: null,
			clearFocusedEpochRange
		};

		navigateToEntryTarget(canvas, {
			kind: "entry",
			date: today,
			entry: {
				file: "daily.md",
				source: "content",
				blockStart: 0,
				blockEnd: 0
			}
		} as any);

		// When animatingView is already true, the scroll should be re-targeted even if the
		// date is currently visible (dayIndex=0 => visible with offsetY=0).
		expect(canvas.targetOffsetY).toBeCloseTo(height * FOCUS_ANCHOR_RATIO, 5);
		expect(canvas.pendingScrollNavHighlight).toBeNull();
		expect(requestHoverAnimation).toHaveBeenCalled();
	});
});
