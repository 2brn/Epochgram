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
});
