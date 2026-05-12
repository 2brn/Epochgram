import { describe, expect, test } from "vitest";
import { buildDenseSummaryRects, computeDenseBarVisual } from "../src/ui/summary-rendering/dense";

function baseArgs(overrides: Partial<any> = {}): any {
	return {
		entries: [],
		dayIndex: 0,
		xStart: 0,
		centerY: 50,
		availableWidth: 100,
		colTextBase: "#000",
		colHighlight: "#f0f",
		colRelated: "#00f",
		markColors: ["#111", "#222", "#333"],
		inheritedMarkIndexByPath: null,
		showHidden: false,
		activeFilePath: null,
		semanticRelatedPaths: null,
		...overrides
	};
}

describe("dense bar record selection", () => {
	test("single dense bar prefers explicitly marked entry", () => {
		const entries = [
			{ file: "a.md" } as any,
			{ file: "b.md", markColor: 2 } as any
		];
		const visual = computeDenseBarVisual(baseArgs({ entries }))!;
		expect(visual.primaryEntry.file).toBe("b.md");
		expect(visual.primaryItemIndex).toBe(1);

		const rects = buildDenseSummaryRects(visual, entries, 0);
		expect(rects).toHaveLength(1);
		expect(rects[0]!.entry.file).toBe("b.md");
	});

	test("single dense bar treats explicit and inherited equally (earliest wins)", () => {
		const entries = [
			{ file: "a.md" } as any,
			{ file: "b.md", markColor: 2 } as any
		];
		const inherited = new Map<string, number>([["a.md", 1]]);
		const visual = computeDenseBarVisual(baseArgs({ entries, inheritedMarkIndexByPath: inherited }))!;
		expect(visual.primaryEntry.file).toBe("a.md");
		expect(visual.primaryItemIndex).toBe(0);

		const rects = buildDenseSummaryRects(visual, entries, 0);
		expect(rects).toHaveLength(1);
		expect(rects[0]!.entry.file).toBe("a.md");
	});

	test("single dense bar prefers inherited-marked entry when no explicit mark", () => {
		const entries = [
			{ file: "a.md" } as any,
			{ file: "b.md" } as any
		];
		const inherited = new Map<string, number>([["b.md", 1]]);
		const visual = computeDenseBarVisual(baseArgs({ entries, inheritedMarkIndexByPath: inherited }))!;
		expect(visual.primaryEntry.file).toBe("b.md");
		expect(visual.primaryItemIndex).toBe(1);

		const rects = buildDenseSummaryRects(visual, entries, 0);
		expect(rects).toHaveLength(1);
		expect(rects[0]!.entry.file).toBe("b.md");
	});
});
