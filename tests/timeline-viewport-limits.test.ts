import { describe, expect, it } from "vitest";
import {
	clampTimelineOffsetToBounds,
	getTimelineViewportBounds
} from "../src/ui/epoch-canvas/viewport-limits";
import { BASE_SPACING } from "../src/ui/epoch-canvas-constants";

describe("timeline viewport limits", () => {
	it("computes ordered hard/core index bounds", () => {
		const today = new Date(2026, 4, 21);
		const bounds = getTimelineViewportBounds(today);
		expect(bounds.hardMinIndex).toBeLessThan(bounds.coreMinIndex);
		expect(bounds.coreMinIndex).toBeLessThan(bounds.coreMaxIndex);
		expect(bounds.coreMaxIndex).toBeLessThan(bounds.hardMaxIndex);
	});

	it("clamps offset to hard timeline bounds", () => {
		const today = new Date(2026, 4, 21);
		const bounds = getTimelineViewportBounds(today);
		const scale = 1;
		const viewportHeight = 900;
		const pxPerDay = BASE_SPACING * scale;
		const minOffset = viewportHeight - bounds.hardMaxIndex * pxPerDay;
		const maxOffset = -bounds.hardMinIndex * pxPerDay;

		expect(
			clampTimelineOffsetToBounds({
				offsetY: minOffset - 1000,
				scale,
				viewportHeight,
				today
			})
		).toBe(minOffset);
		expect(
			clampTimelineOffsetToBounds({
				offsetY: maxOffset + 1000,
				scale,
				viewportHeight,
				today
			})
		).toBe(maxOffset);
		expect(
			clampTimelineOffsetToBounds({
				offsetY: (minOffset + maxOffset) / 2,
				scale,
				viewportHeight,
				today
			})
		).toBe((minOffset + maxOffset) / 2);
	});
});
