import { describe, expect, it } from "vitest";
import { wrapText } from "../src/ui/summary-rendering/text";

function mockCtx(): CanvasRenderingContext2D {
	return {
		measureText: (value: string) => ({ width: value.length } as any)
	} as any;
}

describe("wrapText", () => {
	it("returns empty line when maxWidth <= 0", () => {
		const ctx = mockCtx();
		expect(wrapText(ctx, "Hello world", 0)).toEqual([""]);
		expect(wrapText(ctx, "Hello world", -10)).toEqual([""]);
	});
});
