import { describe, expect, it } from "vitest";

import { buildNormalColumns } from "../src/ui/summary-rendering/normal-measure";
import { renderNormalRow } from "../src/ui/summary-rendering/normal/render-row";
import type { DateEntry } from "../src/indexer/types";

function mockCtx(track: { strokeStyles: string[] }): CanvasRenderingContext2D {
	let fontValue = "12px system-ui";
	let strokeStyleValue: any = "";
	let fillStyleValue: any = "";
	let globalAlphaValue = 1;
	let textAlignValue: any = "left";
	let textBaselineValue: any = "top";
	let lineWidthValue = 1;

	return {
		get font() {
			return fontValue;
		},
		set font(v: string) {
			fontValue = String(v);
		},
		get strokeStyle() {
			return strokeStyleValue;
		},
		set strokeStyle(v: any) {
			strokeStyleValue = v;
			track.strokeStyles.push(String(v));
		},
		get fillStyle() {
			return fillStyleValue;
		},
		set fillStyle(v: any) {
			fillStyleValue = v;
		},
		get globalAlpha() {
			return globalAlphaValue;
		},
		set globalAlpha(v: number) {
			globalAlphaValue = Number(v);
		},
		get textAlign() {
			return textAlignValue;
		},
		set textAlign(v: any) {
			textAlignValue = v;
		},
		get textBaseline() {
			return textBaselineValue;
		},
		set textBaseline(v: any) {
			textBaselineValue = v;
		},
		get lineWidth() {
			return lineWidthValue;
		},
		set lineWidth(v: number) {
			lineWidthValue = Number(v);
		},
		save: () => void 0,
		restore: () => void 0,
		beginPath: () => void 0,
		rect: () => void 0,
		clip: () => void 0,
		moveTo: () => void 0,
		arcTo: () => void 0,
		closePath: () => void 0,
		stroke: () => void 0,
		fill: () => void 0,
		fillText: () => void 0,
		measureText: (value: string) =>
			({
				width: String(value ?? "").length,
				actualBoundingBoxAscent: 8,
				actualBoundingBoxDescent: 2
			} as any)
	} as any;
}

function makeEntry(partial: Partial<DateEntry>): DateEntry {
	return {
		date: partial.date ?? "2025-01-01",
		file: partial.file ?? "folder/note.md",
		blockStart: partial.blockStart ?? 0,
		blockEnd: partial.blockEnd ?? 0,
		summary: partial.summary ?? "alpha beta gamma",
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

describe("compact-mode +n badge accent color", () => {
	it("attaches plusNBadgeColor only to the +n row", () => {
		const track = { strokeStyles: [] as string[] };
		const ctx = mockCtx(track);
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
				entryIndex === lastVisibleIndex ? `+3 ${textToWrap}` : textToWrap,
			decoratePlusNBadgeColor: ({ entryIndex }) => (entryIndex === lastVisibleIndex ? "#f00" : null)
		});

		expect(out.columns[0]!.rows[0]!.plusNBadgeColor ?? null).toBe(null);
		expect(out.columns[0]!.rows[1]!.plusNBadgeColor).toBe("#f00");
	});

	it("uses plusNBadgeColor for the badge stroke", () => {
		const track = { strokeStyles: [] as string[] };
		const ctx = mockCtx(track);

		renderNormalRow({
			ctx,
			r: {
				entryIndex: 0,
				entry: makeEntry({ file: "a.md" }),
				height: 18,
				lines: ["hello"],
				lineHeight: 14,
				maxLineWidth: 10,
				textToWrap: "+3 hello world",
				maxTextWidth: 200,
				summaryHoverT: 0,
				isHoverTarget: false,
				isHoverIncoming: false,
				isActiveEntry: false,
				summaryFont: "12px system-ui",
				needsBoldFont: false,
				isDraft: false,
				padY: 4,
				baseColor: "#000",
				hoverSummaryColor: "#000",
				plusNBadgeColor: "#f00",
				hiddenAlpha: 1,
				leadingIconIds: [],
				hasTagIcon: false,
				leadingIconMetrics: { iconsWidth: 0, totalWidth: 0, textGap: 0, iconSize: 0, pad: 0, baseStroke: 0 } as any,
				tagIconMetrics: { iconsWidth: 0, totalWidth: 0, textGap: 0, iconSize: 0, pad: 0, baseStroke: 0 } as any,
				title: ""
			},
			iconCache: {} as any,
			fontSmallHover: "13px system-ui",
			textModeEnabled: true,
			xStart: 0,
			rowX: 0,
			yItemCenter: 20,
			yRectTop: 10,
			yRectBottom: 30,
			maxWidth: 200,
			clipRight: 200,
			rowT: 0
		});

		expect(track.strokeStyles).toContain("#f00");
	});
});
