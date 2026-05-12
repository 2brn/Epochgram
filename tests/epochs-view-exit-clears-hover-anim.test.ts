import { describe, expect, test, vi } from "vitest";

import { setEpochsView } from "../src/ui/epoch-canvas/epochs-view";

describe("epochs view exit state cleanup", () => {
	test("exiting epochs view clears animSummary/animDateIndex", () => {
		const draw = vi.fn();
		const clearHover = vi.fn();

		const canvas: any = {
			plugin: { settings: { generateEpochs: true } },
			epochsView: true,
			epochsViewBucket: "2025",
			epochsViewPrevBucket: "2024",
			epochsViewBucketAnimStart: 123,

			// Stale anim state that must not leak into normal view.
			animSummary: { dayIndex: 999, itemIndex: 1 },
			animDateIndex: 999,
			hoverSummary: { dayIndex: 999, itemIndex: 1 },
			hoverDateIndex: 999,
			hoverAnim: 1,
			hoverTarget: 1,

			clearHover,
			draw
		};

		// Simulate exit.
		setEpochsView(canvas, false);

		expect(canvas.epochsView).toBe(false);
		expect(canvas.animSummary).toBeNull();
		expect(canvas.animDateIndex).toBeNull();
		expect(canvas.hoverSummary).toBeNull();
		expect(canvas.hoverDateIndex).toBeNull();
		expect(canvas.hoverTarget).toBe(0);
		expect(canvas.hoverAnim).toBe(0);
		expect(clearHover).toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
	});
});
