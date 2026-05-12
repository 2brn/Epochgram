import { describe, expect, it } from "vitest";
import { wrapTextWithFirstLineWidth } from "../src/ui/summary-rendering/text";

function mockCtx(): CanvasRenderingContext2D {
	return {
		measureText: (value: string) => ({ width: value.length } as any)
	} as any;
}

describe("wrapTextWithFirstLineWidth", () => {
	it("uses a tighter width for the first line", () => {
		const ctx = mockCtx();
		expect(wrapTextWithFirstLineWidth(ctx, "alpha beta gamma", 5, 100)).toEqual(["alpha", "beta gamma"]);
	});

	it("falls back to otherLinesWidth when firstLineWidth <= 0", () => {
		const ctx = mockCtx();
		expect(wrapTextWithFirstLineWidth(ctx, "alpha beta", 0, 5)).toEqual(["alpha", "beta"]);
	});
});
