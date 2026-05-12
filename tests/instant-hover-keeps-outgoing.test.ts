import { describe, expect, test, vi } from "vitest";
import { runCanvasAnimation } from "../src/ui/epoch-canvas-animate";

describe("instant hover", () => {
	test("keeps and decays outgoing summaries when hover snaps", () => {
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();
		const startedAt = performance.now() - 50;

		const canvas: any = {
			// animation toggle
			plugin: { settings: { enableAnimation: true } },

			// hover state
			hoverTarget: 1,
			hoverAnim: 1,
			hoverEaseStartAt: null,
			hoverEaseFrom: 1,
			hoverEaseTo: 1,
			animDateIndex: null,
			animSummary: { dayIndex: 10, itemIndex: 0 },
			outgoingSummaries: [{ dayIndex: 9, itemIndex: 0, t: 1, startAt: startedAt, fromT: 1 }],
			outgoingDates: [],
			__globalDenseMode: true,

			// view / inertia
			velocityY: 0,
			offsetY: 0,
			scale: 0.6,
			targetScale: 0.6,
			targetOffsetY: 0,
			animatingView: false,
			lastFrameTime: null,

			// pin fly
			pinFly: null,
			pinFlyOnDone: null,

			requestHoverAnimation,
			draw
		};

		runCanvasAnimation(canvas);

		expect(canvas.hoverAnim).toBe(1);
		expect(Array.isArray(canvas.outgoingSummaries)).toBe(true);
		expect(canvas.outgoingSummaries.length).toBe(1);
		expect(Number(canvas.outgoingSummaries[0].t)).toBeLessThan(1);
	});
});
