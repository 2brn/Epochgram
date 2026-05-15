import { describe, expect, it } from "vitest";

import { findSummaryEntryAtPoint } from "../src/ui/epoch-canvas-hover/hit-test";

describe("findSummaryEntryAtPoint", () => {
	it("selects the closest overlapping entry (not the first)", () => {
		const topEntry = { file: "top.md" } as any;
		const hoveredEntry = { file: "hovered.md" } as any;

		const canvas = {
			activeFilePath: null,
			inheritedMarkSourceByPath: new Map<string, string>(),
			layouts: [
				{
					index: 0,
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					summaryRects: [
						{ x1: 0, y1: 0, x2: 100, y2: 100, itemIndex: 0, entry: topEntry },
						{ x1: 0, y1: 60, x2: 100, y2: 160, itemIndex: 1, entry: hoveredEntry }
					]
				}
			]
		} as any;

		// This point overlaps both rects; it's closer to the second rect's center.
		const hit = findSummaryEntryAtPoint(canvas, 50, 120);
		expect(hit).toBe(hoveredEntry);
	});

	it("uses stable hover rects when summary rects are vertically shifted", () => {
		const targetEntry = { file: "target.md" } as any;
		const belowEntry = { file: "below.md" } as any;

		const canvas = {
			activeFilePath: null,
			inheritedMarkSourceByPath: new Map<string, string>(),
			layouts: [
				{
					index: 0,
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					summaryRects: [
						{ x1: 0, y1: 35, x2: 100, y2: 60, itemIndex: 0, entry: targetEntry },
						{ x1: 0, y1: 80, x2: 100, y2: 110, itemIndex: 1, entry: belowEntry }
					],
					summaryHoverRects: [
						{ x1: 0, y1: 10, x2: 100, y2: 45, itemIndex: 0, entry: targetEntry },
						{ x1: 0, y1: 80, x2: 100, y2: 110, itemIndex: 1, entry: belowEntry }
					]
				}
			]
		} as any;

		// The click is inside the stable hover rect for the first row but outside its animated rect.
		const hit = findSummaryEntryAtPoint(canvas, 50, 18);
		expect(hit).toBe(targetEntry);
	});
});
