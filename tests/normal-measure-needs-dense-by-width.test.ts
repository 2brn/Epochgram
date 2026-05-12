import { describe, expect, it } from "vitest";
import { buildNormalColumns } from "../src/ui/summary-rendering/normal-measure";
import type { DateEntry } from "../src/indexer/types";

function mockCtx(): CanvasRenderingContext2D {
	let fontValue = "12px system-ui";
	return {
		get font() {
			return fontValue;
		},
		set font(v: string) {
			fontValue = String(v);
		},
		save: () => void 0,
		restore: () => void 0,
		measureText: (value: string) => ({ width: String(value ?? "").length } as any)
	} as any;
}

function makeEntry(partial: Partial<DateEntry>): DateEntry {
	return {
		date: partial.date ?? "2025-01-01",
		file: partial.file ?? "folder/note.md",
		blockStart: partial.blockStart ?? 0,
		blockEnd: partial.blockEnd ?? 0,
		summary: partial.summary ?? "Hello world",
		source: (partial as any).source ?? "cdate",
		reviewState: (partial as any).reviewState,
		hidden: (partial as any).hidden,
		pinned: (partial as any).pinned,
		trackedChange: (partial as any).trackedChange,
		trackedTime: (partial as any).trackedTime,
		trackedHash: (partial as any).trackedHash,
		markColor: (partial as any).markColor
	};
}

describe("buildNormalColumns needsDenseByWidth", () => {
	it("is true when at least one row is too narrow to fit even an ellipsis", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ file: "a.md", summary: "A" }),
			makeEntry({ file: "b.md", summary: "B" })
		];

		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 1,
			scale: 1,
			rowHeight: 18,
			hoverAnim: 0,
			animSummary: null,
			activeFilePath: null,
			showHidden: false,
			filenameWordsCount: 2,
			summaryWordsCount: 5,
			fontSmall: "12px system-ui",
			fontSmallHover: "13px system-ui",
			colTextBase: "#000",
			colTextHover: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			getEntryTitle: () => null
		});

		expect(out.needsDenseByWidth).toBe(true);
	});

	it("does not become true just because a row is tag-tinted", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ file: "tagged.md", summary: "A" }),
			makeEntry({ file: "plain.md", summary: "B" })
		];

		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 10,
			scale: 1,
			rowHeight: 18,
			hoverAnim: 0,
			animSummary: null,
			activeFilePath: null,
			showHidden: false,
			filenameWordsCount: 2,
			summaryWordsCount: 5,
			pathsWithEmbeddingTerm: new Set(["tagged.md"]),
			fontSmall: "12px system-ui",
			fontSmallHover: "13px system-ui",
			colTextBase: "#000",
			colTextHover: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			getEntryTitle: () => null
		});

		expect(out.needsDenseByWidth).toBe(false);
	});

	it("is false when no rows are too narrow", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ file: "a.md", summary: "A" }),
			makeEntry({ file: "b.md", summary: "B" })
		];

		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 200,
			scale: 1,
			rowHeight: 18,
			hoverAnim: 0,
			animSummary: null,
			activeFilePath: null,
			showHidden: false,
			filenameWordsCount: 2,
			summaryWordsCount: 5,
			fontSmall: "12px system-ui",
			fontSmallHover: "13px system-ui",
			colTextBase: "#000",
			colTextHover: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			getEntryTitle: () => null
		});

		expect(out.needsDenseByWidth).toBe(false);
	});
});
