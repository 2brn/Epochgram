import { describe, expect, test, vi } from "vitest";

import { setHoverSummary } from "../src/ui/epoch-canvas-focus";

describe("programmatic hover animation", () => {
	test("setHoverSummary restarts hover ease when switching targets", () => {
		const requestHoverAnimation = vi.fn();
		const canvas: any = {
			cancelFocusClear: vi.fn(),
			keepHoverUntilPointerMove: false,
			requestHoverAnimation,
			animDateIndex: null,
			animSummary: { dayIndex: 1, itemIndex: 2 },
			hoverSummary: { dayIndex: 1, itemIndex: 2 },
			hoverDateIndex: null,
			hoverTarget: 1,
			hoverAnim: 1,
			hoverEaseStartAt: null,
			hoverEaseFrom: 1,
			hoverEaseTo: 1
		};

		setHoverSummary(canvas, 3, 4, false);

		expect(canvas.hoverSummary).toEqual({ dayIndex: 3, itemIndex: 4 });
		expect(canvas.animSummary).toEqual({ dayIndex: 3, itemIndex: 4 });
		expect(canvas.hoverTarget).toBe(1);
		// Restarted so the new hover can animate in.
		expect(canvas.hoverAnim).toBe(0);
		expect(canvas.hoverEaseFrom).toBe(0);
		expect(canvas.hoverEaseTo).toBe(1);
		expect(requestHoverAnimation).toHaveBeenCalledTimes(1);
	});

	test("setHoverSummary restarts hover ease when switching from date hover", () => {
		const requestHoverAnimation = vi.fn();
		const canvas: any = {
			cancelFocusClear: vi.fn(),
			keepHoverUntilPointerMove: false,
			requestHoverAnimation,
			animDateIndex: 5,
			animSummary: null,
			hoverSummary: null,
			hoverDateIndex: 5,
			hoverTarget: 1,
			hoverAnim: 1,
			hoverEaseStartAt: null,
			hoverEaseFrom: 1,
			hoverEaseTo: 1
		};

		setHoverSummary(canvas, 3, 4, false);

		expect(canvas.hoverSummary).toEqual({ dayIndex: 3, itemIndex: 4 });
		expect(canvas.animSummary).toEqual({ dayIndex: 3, itemIndex: 4 });
		expect(canvas.hoverTarget).toBe(1);
		expect(canvas.hoverAnim).toBe(0);
		expect(canvas.hoverEaseFrom).toBe(0);
		expect(canvas.hoverEaseTo).toBe(1);
		expect(requestHoverAnimation).toHaveBeenCalledTimes(1);
	});
});
