import { describe, expect, it } from "vitest";
import { buildNormalColumns } from "../src/ui/summary-rendering/normal-measure";
import { computeHoverLayout } from "../src/ui/summary-rendering/normal/hover-layout";
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

describe("normal hover: row-local right shifts", () => {
	it("shifts only rows whose y-range intersects the hovered row", () => {
		const ctx = mockCtx();
		const entries: DateEntry[] = [
			makeEntry({ file: "aaa.md", summary: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
			makeEntry({ file: "ccc.md", summary: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" }),
			makeEntry({ file: "eee.md", summary: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE" }),
			makeEntry({ file: "bbb.md", summary: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }),
			makeEntry({ file: "ddd.md", summary: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD" })
		];

		const rowHeight = 26;
		const { columns } = buildNormalColumns({
			ctx,
			entries,
			dayIndex: 0,
			xStart: 0,
			rightWidth: 110,
			scale: 1,
			rowHeight,
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

		expect(columns.length).toBe(2);
		expect(columns[0]!.rowsThisCol).toBe(3);
		expect(columns[1]!.rowsThisCol).toBe(2);

		const baseRightX = columns[1]!.x;

		const runHover = (leftRowIdx: number) => {
			// Clear hover first.
			for (const c of columns) {
				for (const r of c.rows) {
					r.summaryHoverT = 0;
					r.isHoverIncoming = false;
					r.isHoverTarget = false;
				}
			}
			columns[0]!.rows[leftRowIdx]!.summaryHoverT = 1;
			columns[0]!.rows[leftRowIdx]!.isHoverIncoming = true;
			columns[0]!.rows[leftRowIdx]!.isHoverTarget = true;
			return computeHoverLayout({
				ctx,
				columns,
				dayIndex: 0,
				dayCenterY: 0,
				xStart: 0,
				rightWidth: 110,
				scale: 1,
				rowHeight,
				animSummary: null,
				fontSmallHover: "13px system-ui",
				allowRightColumnShift: true,
				allowVerticalNeighborShift: true,
				allowRowHeightExpansion: true
			});
		};

		// AAA hover => shift BBB only (right row 0)
		{
			const out = runHover(0);
			const r0 = out.rowLayoutByCol[1]![0]!.rowX;
			const r1 = out.rowLayoutByCol[1]![1]!.rowX;
			expect(r0).toBeGreaterThan(baseRightX);
			expect(r1).toBeCloseTo(baseRightX, 6);
		}

		// CCC hover => shift BBB and DDD (right rows 0 and 1)
		{
			const out = runHover(1);
			const r0 = out.rowLayoutByCol[1]![0]!.rowX;
			const r1 = out.rowLayoutByCol[1]![1]!.rowX;
			expect(r0).toBeGreaterThan(baseRightX);
			expect(r1).toBeGreaterThan(baseRightX);
		}

		// EEE hover => shift DDD only (right row 1)
		{
			const out = runHover(2);
			const r0 = out.rowLayoutByCol[1]![0]!.rowX;
			const r1 = out.rowLayoutByCol[1]![1]!.rowX;
			expect(r0).toBeCloseTo(baseRightX, 6);
			expect(r1).toBeGreaterThan(baseRightX);
		}
	});
});
