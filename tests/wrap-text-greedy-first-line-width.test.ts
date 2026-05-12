import { describe, expect, it } from "vitest";
import { wrapTextGreedyWithFirstLineWidth } from "../src/ui/summary-rendering/text";

function mockCtx(): CanvasRenderingContext2D {
	return {
		measureText: (value: string) => ({ width: value.length } as any)
	} as any;
}

describe("wrapTextGreedyWithFirstLineWidth", () => {
	it("fills remaining space by splitting filename-ish tokens", () => {
		const ctx = mockCtx();
		expect(wrapTextGreedyWithFirstLineWidth(ctx, "hello 1234567890.png", 10, 100)).toEqual([
			"hello 1234",
			"567890.png"
		]);
	});

	it("does not split normal words", () => {
		const ctx = mockCtx();
		expect(wrapTextGreedyWithFirstLineWidth(ctx, "alpha beta gamma", 5, 100)).toEqual([
			"alpha",
			"beta gamma"
		]);
	});
});
