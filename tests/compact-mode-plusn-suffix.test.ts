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
		summary:
			partial.summary ??
			"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
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

describe("compact-mode +0..9 prefix", () => {
	it("prefixes +0..9 only on the last visible entry", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ file: "a.md", summary: "first" }),
			makeEntry({ file: "b.md", summary: "second" })
		];
		const lastVisibleIndex = entries.length - 1;
		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 200,
			scale: 2,
			rowHeight: 18,
			hoverAnim: 0,
			animSummary: null,
			activeFilePath: null,
			showHidden: false,
			fontSmall: "12px system-ui",
			fontSmallHover: "13px system-ui",
			colTextBase: "#000",
			colTextHover: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			getEntryTitle: () => null,
			decorateTextToWrap: ({ entryIndex, textToWrap }) =>
				entryIndex === lastVisibleIndex ? `+3 ${textToWrap}` : textToWrap
		});

		expect(out.columns.length).toBe(1);
		expect(out.columns[0]!.rows.length).toBe(2);
		expect(out.columns[0]!.rows[0]!.textToWrap.includes("+")).toBe(false);
		expect(out.columns[0]!.rows[1]!.textToWrap.startsWith("+3 ")).toBe(true);
	});

	it("preserves +0..9 prefix when forced into single-line truncation", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [makeEntry({ file: "a.md" })];

		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 12,
			scale: 1,
			rowHeight: 18,
			hoverAnim: 0,
			animSummary: null,
			activeFilePath: null,
			showHidden: false,
			fontSmall: "12px system-ui",
			fontSmallHover: "13px system-ui",
			colTextBase: "#000",
			colTextHover: "#000",
			colHighlight: "#f00",
			colRelated: "#00f",
			getEntryTitle: () => null,
			decorateTextToWrap: ({ textToWrap }) => `+9 ${textToWrap}`
		});

		const label = out.columns[0]!.rows[0]!.lines[0]!;
		expect(label.startsWith("+9")).toBe(true);
	});
});
