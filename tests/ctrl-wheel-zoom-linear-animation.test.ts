import { describe, expect, test, vi } from "vitest";

import { handleWheel } from "../src/ui/epoch-canvas-events/wheel";
import { runCanvasAnimation } from "../src/ui/epoch-canvas-animate";

function makeCanvas(): any {
	const draw = vi.fn();
	const requestHoverAnimation = vi.fn();
	const clearHover = vi.fn();

	return {
		plugin: { settings: { enableAnimation: true } },
		offsetY: 0,
		scale: 1,
		targetScale: 1,
		targetOffsetY: 0,
		animatingView: false,
		viewInteractionUntil: 0,
		velocityY: 0,
		lastFrameTime: null,
		hoverTarget: 0,
		hoverAnim: 0,
		hoverEaseStartAt: null,
		hoverEaseFrom: 0,
		hoverEaseTo: 0,
		animDateIndex: null,
		animSummary: null,
		hoverDateIndex: null,
		hoverSummary: null,
		layouts: [],
		epochsView: false,
		suppressHoverUntil: 0,
		suppressHoverUntilPointerMove: false,
		keepHoverUntilPointerMove: false,
		pendingScrollNavHighlight: null,
		draw,
		requestHoverAnimation,
		clearHover,
		advanceScrollNav: vi.fn(),
		getScrollAnchorDayIndex: () => null,
		canvas: {
			getBoundingClientRect: () => ({ top: 0, height: 800 })
		},
		root: {
			getBoundingClientRect: () => ({ height: 800 })
		}
	};
}

describe("ctrl/meta wheel zoom linear animation", () => {
	test("ctrl+wheel sets a target and animates in log space", () => {
		const canvas = makeCanvas();
		const spy = vi.spyOn(performance, "now");

		spy.mockReturnValue(0);
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 200,
			deltaY: -120,
			deltaX: 0,
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			altKey: false
		} as any);

		expect((canvas as any).animatingWheelZoom).toBe(true);
		expect(canvas.targetScale).toBeGreaterThan(1);
		// No snap: scale remains at its current value until animation advances.
		expect(canvas.scale).toBe(1);

		spy.mockReturnValue(16);
		runCanvasAnimation(canvas);
		// First frame establishes lastFrameTime; no dt step guaranteed.
		const s1 = canvas.scale;

		spy.mockReturnValue(32);
		runCanvasAnimation(canvas);
		const s2 = canvas.scale;
		expect(s2).toBeGreaterThan(s1);

		spy.mockReturnValue(48);
		runCanvasAnimation(canvas);
		const s3 = canvas.scale;
		expect(s3).toBeGreaterThan(s2);

		// Verify constant-rate stepping in log space for equal dt.
		const d1 = Math.log(s2) - Math.log(s1);
		const d2 = Math.log(s3) - Math.log(s2);
		expect(d2).toBeCloseTo(d1, 6);

		spy.mockRestore();
	});

	test("direction change while animating retargets immediately", () => {
		const canvas = makeCanvas();
		const spy = vi.spyOn(performance, "now");

		spy.mockReturnValue(0);
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 200,
			deltaY: -120,
			deltaX: 0,
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			altKey: false
		} as any);

		spy.mockReturnValue(16);
		runCanvasAnimation(canvas);
		spy.mockReturnValue(32);
		runCanvasAnimation(canvas);
		const scaleBeforeReverse = canvas.scale;

		spy.mockReturnValue(40);
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 200,
			deltaY: 120,
			deltaX: 0,
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			altKey: false
		} as any);

		expect((canvas as any).animatingWheelZoom).toBe(true);
		expect(canvas.targetScale).toBeLessThan(scaleBeforeReverse);

		spy.mockReturnValue(56);
		runCanvasAnimation(canvas);
		expect(canvas.scale).toBeLessThan(scaleBeforeReverse);

		spy.mockRestore();
	});
});
