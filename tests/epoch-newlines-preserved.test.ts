import { describe, expect, it } from "vitest";
import { buildEpochRows } from "../src/ui/summary-rendering/epochs/rows";

function mockCtx(): CanvasRenderingContext2D {
	return {
		font: "12px system-ui",
		save: () => {},
		restore: () => {},
		measureText: (value: string) =>
			({
				width: value.length,
				actualBoundingBoxAscent: 10,
				actualBoundingBoxDescent: 2
			} as any)
	} as any;
}

describe("epoch rendering", () => {
	it("preserves explicit newlines as hard breaks", () => {
		const ctx = mockCtx();
		const entry: any = {
			date: "2026-02-17",
			file: "epoch://day/2026-02-17-2026-02-17",
			source: "epoch",
			summary:
				"Epoch GitHub repository link edited\nSearch active styles edited\nHerd mentality experience detailed"
		};

		const { rows } = buildEpochRows({
			ctx,
			entries: [entry],
			dayIndex: 0,
			xStart: 0,
			rightWidth: 1000,
			rowHeight: 16,
			hoverAnim: 0,
			hoverGap: 0,
			animSummary: null,
			outgoingSummaries: null,
			activeFilePath: null,
			showHidden: false,
			fontSmall: "12px system-ui",
			fontSmallHover: "12px system-ui",
			fontEpochLine1: "16px system-ui",
			fontEpochLine1Hover: "16px system-ui",
			colTextBase: "#000000",
			colTextHover: "#000000",
			colHighlight: "#000000",
			colRelated: "#000000",
			wrapFadeCache: null,
			dayCenterY: 0
		} as any);

		expect(rows.length).toBe(1);
		expect(rows[0]!.lines.slice(0, 3)).toEqual([
			"Epoch GitHub repository link edited",
			"Search active styles edited",
			"Herd mentality experience detailed"
		]);
	});

	it("does not start wrapped lines with ','", () => {
		const ctx = mockCtx();
		const entry: any = {
			date: "2026-02-17",
			file: "epoch://day/2026-02-17-2026-02-17",
			source: "epoch",
			summary: "Alpha, beta gamma"
		};

		const { rows } = buildEpochRows({
			ctx,
			entries: [entry],
			dayIndex: 0,
			xStart: 0,
			rightWidth: 14,
			rowHeight: 16,
			hoverAnim: 0,
			hoverGap: 0,
			animSummary: null,
			outgoingSummaries: null,
			activeFilePath: null,
			showHidden: false,
			fontSmall: "12px system-ui",
			fontSmallHover: "12px system-ui",
			fontEpochLine1: "16px system-ui",
			fontEpochLine1Hover: "16px system-ui",
			colTextBase: "#000000",
			colTextHover: "#000000",
			colHighlight: "#000000",
			colRelated: "#000000",
			wrapFadeCache: null,
			dayCenterY: 0
		} as any);

		expect(rows.length).toBe(1);
		for (const l of rows[0]!.lines) {
			expect(String(l).trimStart().startsWith(",")).toBe(false);
		}
		expect(rows[0]!.lines).toEqual(["Alpha,", "beta", "gamma"]);
	});

	it("does not start wrapped lines with ':'", () => {
		const ctx = mockCtx();
		const entry: any = {
			date: "2026-02-17",
			file: "epoch://day/2026-02-17-2026-02-17",
			source: "epoch",
			summary: "Obsidian Markdown Notes\n: Resend"
		};

		const { rows } = buildEpochRows({
			ctx,
			entries: [entry],
			dayIndex: 0,
			xStart: 0,
			rightWidth: 1000,
			rowHeight: 16,
			hoverAnim: 0,
			hoverGap: 0,
			animSummary: null,
			outgoingSummaries: null,
			activeFilePath: null,
			showHidden: false,
			fontSmall: "12px system-ui",
			fontSmallHover: "12px system-ui",
			fontEpochLine1: "16px system-ui",
			fontEpochLine1Hover: "16px system-ui",
			colTextBase: "#000000",
			colTextHover: "#000000",
			colHighlight: "#000000",
			colRelated: "#000000",
			wrapFadeCache: null,
			dayCenterY: 0
		} as any);

		expect(rows.length).toBe(1);
		for (const l of rows[0]!.lines) {
			expect(String(l).trimStart().startsWith(":")).toBe(false);
		}
		expect(rows[0]!.lines).toEqual(["Obsidian Markdown Notes:", "Resend"]);
	});
});
