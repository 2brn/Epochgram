import { describe, expect, it } from "vitest";
import { buildNormalColumns } from "../src/ui/summary-rendering/normal-measure";
import type { DateEntry } from "../src/indexer/types";
import { formatDate } from "utils";

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

function makeEntry(partial: Partial<DateEntry> & Pick<DateEntry, "source">): DateEntry {
	return {
		date: partial.date ?? "2025-01-01",
		file: partial.file ?? "folder/note.md",
		blockStart: partial.blockStart ?? 0,
		blockEnd: partial.blockEnd ?? 0,
		summary: partial.summary ?? "Hello world",
		source: partial.source,
		reviewState: partial.reviewState,
		hidden: partial.hidden,
		pinned: partial.pinned,
		trackedChange: partial.trackedChange,
		trackedTime: partial.trackedTime,
		trackedHash: partial.trackedHash,
		markColor: partial.markColor
	};
}

describe("Draft entries render italic across sources", () => {
	it("uses italic for cdate/namedate/content/tracked when reviewState is draft", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ source: "cdate", file: "cdate.md", reviewState: "draft" }),
			makeEntry({ source: "namedate", file: "namedate.md", reviewState: "draft" }),
			makeEntry({ source: "content", file: "content.md", reviewState: "draft" }),
			makeEntry({ source: "tracked", file: "tracked.md", reviewState: "draft", trackedChange: "modified" })
		];

		const out = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 600,
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
			getEntryTitle: () => null
		});

		const rows = out.columns.flatMap((c) => c.rows);
		const bySource = new Map<string, string>();
		for (const r of rows) {
			bySource.set(String(r.entry.source), String(r.summaryFont));
		}

		expect(bySource.get("cdate") ?? "").toMatch(/\bitalic\b/i);
		expect(bySource.get("namedate") ?? "").toMatch(/\bitalic\b/i);
		expect(bySource.get("content") ?? "").toMatch(/\bitalic\b/i);
		expect(bySource.get("tracked") ?? "").toMatch(/\bitalic\b/i);
	});

	it("keeps italic even when the row is bold (e.g. pinned today)", () => {
		const ctx = mockCtx();
		const todayKey = formatDate(new Date());
		const entry = makeEntry({
			source: "cdate",
			file: "pinned.md",
			date: todayKey,
			pinned: true,
			reviewState: "draft"
		});

		const out = buildNormalColumns({
			ctx,
			entries: [entry],
			dayIndex: 0,
			xStart: 0,
			rightWidth: 600,
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
			getEntryTitle: () => null
		});

		const row = out.columns[0]?.rows[0];
		expect(row).toBeDefined();
		expect(row!.needsBoldFont).toBe(true);
		expect(row!.summaryFont).toMatch(/\bitalic\b/i);
		expect(row!.summaryFont).toMatch(/\b700\b/);
	});
});
