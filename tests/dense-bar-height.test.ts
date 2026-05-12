import { describe, expect, it } from "vitest";
import { computeDenseBarVisual } from "../src/ui/summary-rendering/dense";
import type { DateEntry } from "../src/indexer/types";

function makeEntry(file: string): DateEntry {
	return {
		date: "2025-01-01",
		file,
		blockStart: 0,
		blockEnd: 0,
		summary: "",
		source: "cdate"
	} as any;
}

describe("dense bar height", () => {
	it("uses desiredBarHeight when provided", () => {
		const entries = [makeEntry("a.md")];
		const visual = computeDenseBarVisual({
			entries,
			dayIndex: 0,
			xStart: 10,
			centerY: 50,
			availableWidth: 100,
			desiredBarHeight: 42,
			colTextBase: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			showHidden: false,
			activeFilePath: null
		});
		expect(visual?.barHeight).toBe(42);
	});

	it("clamps desiredBarHeight to maxBarHeight", () => {
		const entries = [makeEntry("a.md")];
		const visual = computeDenseBarVisual({
			entries,
			dayIndex: 0,
			xStart: 10,
			centerY: 50,
			availableWidth: 100,
			desiredBarHeight: 120,
			maxBarHeight: 25,
			colTextBase: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			showHidden: false,
			activeFilePath: null
		});
		expect(visual?.barHeight).toBe(25);
	});
});
