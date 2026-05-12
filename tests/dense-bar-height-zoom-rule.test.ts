import { describe, expect, it } from "vitest";
import { estimateDenseBarHeightForDenseMode } from "../src/ui/summary-rendering/dense-height";
import { SUMMARY_MIN_SCALE, SUMMARY_PLACEHOLDER_STROKE_WIDTH } from "../src/ui/epoch-canvas-constants";

describe("dense bar height zoom rule", () => {
	it("uses placeholder-thickness scaling at or below SUMMARY_MIN_SCALE (4 entries per unit)", () => {
		const rowHeight = 25;
		const scale = SUMMARY_MIN_SCALE;

		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 1 })).toBe(
			1 * SUMMARY_PLACEHOLDER_STROKE_WIDTH
		);
		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 4 })).toBe(
			1 * SUMMARY_PLACEHOLDER_STROKE_WIDTH
		);
		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 5 })).toBe(
			2 * SUMMARY_PLACEHOLDER_STROKE_WIDTH
		);
		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 8 })).toBe(
			2 * SUMMARY_PLACEHOLDER_STROKE_WIDTH
		);
		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 9 })).toBe(
			3 * SUMMARY_PLACEHOLDER_STROKE_WIDTH
		);
	});

	it("uses text-row stacking above SUMMARY_MIN_SCALE", () => {
		const rowHeight = 25;
		const scale = 1;

		// At zoom-in dense mode, the day shows multiple thin bars (one per visible row slot),
		// spaced by rowHeight. With scale=1, maxRows=3 -> group extent is 2*rowHeight + stroke.
		expect(estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: 10 })).toBe(51);
	});
});
