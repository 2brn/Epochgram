import { describe, expect, test, vi } from "vitest";
import { runCanvasAnimation } from "../src/ui/epoch-canvas-animate";

describe("force hover ease", () => {
	test("does not affect instant-hover snapping", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const now = performance.now();

		const canvas: any = {
			plugin: { settings: { enableAnimation: true } },

			// Force easing even in dense mode
			__globalDenseMode: true,
			__forceHoverEaseUntil: now + 1000,

			hoverTarget: 1,
			hoverAnim: 0,
			hoverEaseStartAt: now - 100,
			hoverEaseFrom: 0,
			hoverEaseTo: 1,
			animDateIndex: null,
			animSummary: { dayIndex: 10, itemIndex: 0 },
			outgoingSummaries: [],
			outgoingDates: [],

			velocityY: 0,
			offsetY: 0,
			scale: 0.6,
			targetScale: 0.6,
			targetOffsetY: 0,
			animatingView: false,
			lastFrameTime: now - 100,

			pinFly: null,
			pinFlyOnDone: null,

			requestHoverAnimation,
			draw
		};

		runCanvasAnimation(canvas);
		expect(canvas.hoverAnim).toBe(1);
		expect(canvas.hoverEaseStartAt).toBeNull();
		expect(canvas.hoverEaseFrom).toBe(1);
		expect(canvas.hoverEaseTo).toBe(1);
	});
});
