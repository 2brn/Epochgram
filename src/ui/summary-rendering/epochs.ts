import type { DateEntry } from "../../indexer/types";
import type { HoverOverlay, SummaryRect } from "../epoch-canvas-types";
import { DROP_CAP_SCALE, HOVER_BG_PAD, HOVER_HIT_PAD, TOUCH_HIT_PAD } from "../epoch-canvas-constants";
import type { DaySummaryRenderResult } from "./types";
import { parseFontPx } from "./text";
import {
	buildEpochRows,
	drawDropCapPrefixLine,
	drawDropCapPrefixRestLine,
	replaceFontPx,
	type EpochRenderRow,
	type EpochRenderRowSnapshot
} from "./epochs/rows";

export interface EpochsSummaryRenderArgs {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	dayIndex: number;
	dayCenterY: number;
	xStart: number;
	rightWidth: number;
	rowHeight: number;
	hoverAnim: number;
	hoverGap: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	wrapFadeCache?: Map<string, any> | null;
	activeFilePath: string | null;
	showHidden: boolean;
	hiddenOnly?: boolean;
	fontSmall: string;
	fontSmallHover: string;
	fontEpochLine1?: string;
	fontEpochLine1Hover?: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	/** Epochs view only: visibility of *marked* (color-marked) child records under current filters. */
	epochsViewMarkedChildVisibleByDateKey?: Map<string, boolean> | null;
	/** When true, render epochs as normal small text (no drop-caps). */
	disableDropCaps?: boolean;
}

export function measureEpochsDaySummariesHeight(args: EpochsSummaryRenderArgs): number {
	const { rows, totalHeight } = buildEpochRows(args);
	return rows.length > 0 ? totalHeight : 0;
}

export function renderEpochsDaySummaries(args: EpochsSummaryRenderArgs): DaySummaryRenderResult {
	const {
		ctx,
		dayIndex,
		dayCenterY,
		hoverAnim,
		hoverGap,
		animSummary,
	} = args;

	const summaryRects: SummaryRect[] = [];
	const summaryHoverRects: SummaryRect[] = [];
	let hoverOverlay: HoverOverlay | null = null;

	const snapshotOf = (r: EpochRenderRow): EpochRenderRowSnapshot => ({
		lines: r.lines.slice(),
		dropLineCount: r.dropLineCount,
		hasDropMixedLine: r.hasDropMixedLine,
		dropMixedPrefix: r.dropMixedPrefix,
		dropMixedRest: r.dropMixedRest,
		color: r.color,
		hoverColor: r.hoverColor,
		hiddenAlpha: r.hiddenAlpha,
		textStartX: r.textStartX,
		font: r.font,
		lineHeight: r.lineHeight,
		firstLineFont: r.firstLineFont,
		firstLineHeight: r.firstLineHeight
	});


	const parseCssColor = (raw: string): { r: number; g: number; b: number; a: number } | null => {
		const v = String(raw || "").trim();
		if (!v) return null;
		const hex = v.startsWith("#") ? v.slice(1) : "";
		if (hex) {
			const h = hex.length === 3
				? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
				: hex.length === 4
					? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
					: hex;
			if (h.length === 6 || h.length === 8) {
				const r = parseInt(h.slice(0, 2), 16);
				const g = parseInt(h.slice(2, 4), 16);
				const b = parseInt(h.slice(4, 6), 16);
				const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
				if ([r, g, b, a].every((n) => Number.isFinite(n))) return { r, g, b, a };
			}
		}
		const m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
		if (m) {
			const r = Number(m[1]);
			const g = Number(m[2]);
			const b = Number(m[3]);
			const a = m[4] != null ? Number(m[4]) : 1;
			if ([r, g, b, a].every((n) => Number.isFinite(n))) return { r, g, b, a };
		}
		return null;
	};

	const mixCssColor = (a: string, b: string, tRaw: number): string => {
		const t = Math.max(0, Math.min(1, Number(tRaw) || 0));
		if (t <= 0.001) return a;
		if (t >= 0.999) return b;
		const ca = parseCssColor(a);
		const cb = parseCssColor(b);
		if (!ca || !cb) return t >= 0.5 ? b : a;
		const r = Math.round(ca.r + (cb.r - ca.r) * t);
		const g = Math.round(ca.g + (cb.g - ca.g) * t);
		const bb = Math.round(ca.b + (cb.b - ca.b) * t);
		const aa = ca.a + (cb.a - ca.a) * t;
		return `rgba(${r}, ${g}, ${bb}, ${Math.max(0, Math.min(1, aa))})`;
	};

	const drawLines = (
		s: EpochRenderRowSnapshot,
		yBlockTop: number,
		alpha: number,
		hoverT: number
	): void => {
		if (alpha <= 0.001) return;
		ctx.save();
		ctx.globalAlpha *= Math.max(0, alpha) * (s.hiddenAlpha ?? 1);
		ctx.fillStyle = mixCssColor(s.color, s.hoverColor, hoverT);
		ctx.textBaseline = "alphabetic";
		let yLineTop = yBlockTop;
		for (let li = 0; li < s.lines.length; li++) {
			const label = s.lines[li] ?? "";
			const isDropLine = li < s.dropLineCount;
			const h = isDropLine ? s.firstLineHeight : s.lineHeight;
			const ascent = Math.max(0, Math.min(h, Math.round(h * 0.8)));
			const yy = yLineTop + ascent;
			if (isDropLine) {
				if (li === s.dropLineCount - 1 && s.hasDropMixedLine) {
					drawDropCapPrefixRestLine(
						ctx,
						s.dropMixedPrefix ?? label,
						s.dropMixedRest ?? "",
						s.textStartX,
						yy,
						s.firstLineFont,
						DROP_CAP_SCALE
					);
				} else {
					drawDropCapPrefixLine(ctx, label, s.textStartX, yy, s.firstLineFont, DROP_CAP_SCALE);
				}
			} else {
				ctx.font = s.font;
				ctx.fillText(label, s.textStartX, yy);
			}
			yLineTop += h;
		}
		ctx.restore();
	};

	ctx.textAlign = "left";
	const { rows, totalHeight } = buildEpochRows(args);
	if (rows.length === 0) {
		return { summaryRects, hoverOverlay };
	}

	let yCursor = dayCenterY - totalHeight / 2;

	for (let ri = 0; ri < rows.length; ri++) {
		const r = rows[ri]!;
		if (ri > 0) yCursor += (hoverGap / 2) * Math.max(0, Math.min(1, r.hoverT));
		const yTop = yCursor;
		const yBottom = yTop + r.height;
		const yCenter = (yTop + yBottom) / 2;
		const blockHeight =
			Math.max(0, r.dropLineCount) * r.firstLineHeight + Math.max(0, r.lines.length - r.dropLineCount) * r.lineHeight;
		const yBlockTop = yCenter - blockHeight / 2;
		const firstAscent = Math.max(0, Math.min(r.firstLineHeight, Math.round(r.firstLineHeight * 0.8)));
		const yFirstLine = yBlockTop + firstAscent;

		const isIncomingHover =
			!!(
				animSummary &&
				animSummary.dayIndex === dayIndex &&
				animSummary.itemIndex === r.index &&
				hoverAnim > 0
			);
		if (isIncomingHover && r.lines.length > 0) {
			ctx.save();
			const dropFont = replaceFontPx(
				r.firstLineFont,
				Math.max(parseFontPx(r.firstLineFont), parseFontPx(r.firstLineFont) * DROP_CAP_SCALE)
			);
			let maxLineWidth = 0;
			for (let li = 0; li < r.lines.length; li++) {
				const label = r.lines[li] ?? "";
				if (li < r.dropLineCount) {
					if (li === r.dropLineCount - 1 && r.hasDropMixedLine) {
						const prefixPart = r.dropMixedPrefix ?? "";
						const restPart = r.dropMixedRest ?? "";
						let w = 0;
						ctx.font = dropFont;
						w += ctx.measureText(prefixPart).width;
						w += 2;
						ctx.font = r.firstLineFont;
						w += ctx.measureText(restPart).width;
						if (w > maxLineWidth) maxLineWidth = w;
					} else {
						ctx.font = dropFont;
						const w = ctx.measureText(label).width;
						if (w > maxLineWidth) maxLineWidth = w;
					}
				} else {
					ctx.font = r.font;
					const w = ctx.measureText(label).width;
					if (w > maxLineWidth) maxLineWidth = w;
				}
			}
			ctx.restore();

			hoverOverlay = {
				x: r.textStartX,
				yTop,
				yBottom,
				yCenter,
				width: maxLineWidth + HOVER_BG_PAD * 2,
				isEpoch: true,
				yTextTop: yBlockTop,
				epochDropLineCount: r.dropLineCount,
				epochHasDropMixedLine: r.hasDropMixedLine,
				epochDropMixedPrefix: r.dropMixedPrefix,
				epochDropMixedRest: r.dropMixedRest,
				text: r.lines[0] ?? "",
				lines: r.lines,
				yFirstLine,
				lineHeight: r.lineHeight,
				firstLineFont: r.firstLineFont,
				firstLineHeight: r.firstLineHeight,
				font: r.font,
				color: r.hoverColor,
				alpha: r.hiddenAlpha
			};
		} else {
			const curSnap = snapshotOf(r);
			drawLines(curSnap, yBlockTop, 1, r.hoverT);
		}

		summaryRects.push({
			x1: args.xStart - TOUCH_HIT_PAD,
			y1: yTop - TOUCH_HIT_PAD,
			x2: args.xStart + args.rightWidth + TOUCH_HIT_PAD,
			y2: yBottom + TOUCH_HIT_PAD,
			itemIndex: r.index,
			entry: r.entry
		});

		summaryHoverRects.push({
			x1: args.xStart - HOVER_HIT_PAD,
			y1: yTop - HOVER_HIT_PAD,
			x2: args.xStart + args.rightWidth + HOVER_HIT_PAD,
			y2: yBottom + HOVER_HIT_PAD,
			itemIndex: r.index,
			entry: r.entry
		});

		yCursor = yBottom;
		if (ri < rows.length - 1) yCursor += (hoverGap / 2) * Math.max(0, Math.min(1, r.hoverT));
	}

	return { summaryRects, summaryHoverRects, hoverOverlay };
}
