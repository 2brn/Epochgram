import type { DateEntry } from "../../../indexer/types";
import {
	DROP_CAP_SCALE,
	SUMMARY_HIDDEN_ALPHA
} from "../../epoch-canvas-constants";
import { getEpochRangeFromEntry, mixFont, withFontStyle } from "../../epoch-canvas-utils";
import { splitLeadByStopWordsOrPunctuation } from "../../drop-cap";
import { getEntryMarkColor, getInheritedMarkColor } from "../entry-mark-colors";
import { parseFontPx, measureVerticalMetrics, wrapText, wrapTextWithFirstLineWidth } from "../text";
import type { EpochsSummaryRenderArgs } from "../epochs";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateKey(value: string): boolean {
	return DATE_KEY_RE.test(String(value || ""));
}

function dateKeyToUtcMs(key: string): number {
	if (!isDateKey(key)) return Number.NaN;
	const [yyRaw, mmRaw, ddRaw] = key.split("-");
	const yy = Number(yyRaw);
	const mm = Number(mmRaw);
	const dd = Number(ddRaw);
	if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return Number.NaN;
	return Date.UTC(yy, mm - 1, dd);
}

function epochRangeHasAnyVisibleMarkedChild(
	range: { start: string; end: string },
	markedByDateKey: Map<string, boolean>
): boolean {
	const startMs = dateKeyToUtcMs(range.start);
	const endMs = dateKeyToUtcMs(range.end);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return true;
	if (endMs < startMs) return true;
	for (let t = startMs; t <= endMs; t += 86_400_000) {
		const key = new Date(t).toISOString().slice(0, 10);
		if (markedByDateKey.get(key) === true) return true;
	}
	return false;
}

export type EpochRenderRowSnapshot = {
	lines: string[];
	dropLineCount: number;
	hasDropMixedLine: boolean;
	dropMixedPrefix?: string;
	dropMixedRest?: string;
	color: string;
	hoverColor: string;
	hiddenAlpha: number;
	textStartX: number;
	font: string;
	lineHeight: number;
	firstLineFont: string;
	firstLineHeight: number;
};

export type EpochRenderRow = {
	entry: DateEntry;
	index: number;
	lines: string[];
	dropLineCount: number;
	hasDropMixedLine: boolean;
	dropMixedPrefix?: string;
	dropMixedRest?: string;
	height: number;
	color: string;
	hoverColor: string;
	hoverT: number;
	hiddenAlpha: number;
	textStartX: number;
	maxTextWidth: number;
	font: string;
	lineHeight: number;
	firstLineFont: string;
	firstLineHeight: number;
	firstLineAscent: number;
	firstLineDescent: number;
};

export function replaceFontPx(font: string, px: number): string {
	const raw = String(font || "");
	const safePx = Number.isFinite(px) ? px : 12;
	if (!raw) return `${safePx}px system-ui`;
	if (!/(\d+(?:\.\d+)?)px/.test(raw)) return raw;
	return raw.replace(/(\d+(?:\.\d+)?)px/, `${safePx.toFixed(2).replace(/\.00$/, "")}px`);
}

export function buildEpochRows(args: EpochsSummaryRenderArgs): {
	rows: EpochRenderRow[];
	totalHeight: number;
	maxWidth: number;
	x: number;
} {
	const {
		ctx,
		entries,
		dayIndex,
		xStart,
		rightWidth,
		rowHeight,
		hoverAnim,
		hoverGap,
		animSummary,
		outgoingSummaries,
		activeFilePath,
		showHidden,
		fontSmall,
		fontSmallHover,
		fontEpochLine1,
		fontEpochLine1Hover,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		epochsViewMarkedChildVisibleByDateKey,
		disableDropCaps
	} = args;

	const hiddenOnly = args.hiddenOnly === true;
	const disableDraftItalics = false;

	// Epochs view: allow the right-side text column to expand with the available panel width.
	// (Unlike normal summaries, epochs are already few and benefit from wider formatting.)
	const colWidth = rightWidth;
	const maxWidth = colWidth - 4;
	const x = xStart;

	const baseFontPx = parseFontPx(fontSmall);
	const baseLineHeight = Math.max(12, Math.round(baseFontPx * 1.25));
	const padY = 4;
	const padX = 0;

	const rows: EpochRenderRow[] = [];
	const fixLeadingPunctuationLines = (value: string[]): string[] => {
		const lines = Array.isArray(value) ? value.slice() : [];
		for (let i = 1; i < lines.length; i++) {
			const prevRaw = String(lines[i - 1] ?? "");
			const curRaw = String(lines[i] ?? "");
			const prev = prevRaw.trimEnd();
			const cur = curRaw.trimStart();
			if (!/^[,.;:!?]+/.test(cur)) continue;

			const m = cur.match(/^[,.;:!?]+/);
			const punctuation = m ? m[0] : "";
			if (!punctuation) continue;
			const rest = cur.slice(punctuation.length).trimStart();
			if (!prev.trim()) continue;

			lines[i - 1] = prev + punctuation;
			if (rest) {
				lines[i] = rest;
			} else {
				// Drop the now-empty line.
				lines.splice(i, 1);
				i--;
			}
		}
		return lines;
	};
	const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
	const outgoingTFor = (itemIndex: number): number => {
		if (!Array.isArray(outgoingSummaries) || outgoingSummaries.length === 0) return 0;
		for (let i = 0; i < outgoingSummaries.length; i++) {
			const o = outgoingSummaries[i]!;
			if (o.dayIndex === dayIndex && o.itemIndex === itemIndex) {
				return clamp01(Number(o.t));
			}
		}
		return 0;
	};
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
		const entry = entries[entryIndex]!;
		if (!entry.file.startsWith("epoch://")) continue;

		const isDraft = entry.reviewState === "draft";
		const isDraftItalic = isDraft && !disableDraftItalics;

		const isActiveEntry = !!(activeFilePath && entry.file === activeFilePath);
		const isHiddenEntry = entry.reviewState === "hidden";
		const hiddenVisible = showHidden && isHiddenEntry;
		const markColor = getEntryMarkColor(entry, markColors, colHighlight);
		let inheritedColor = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
		if (inheritedColor && epochsViewMarkedChildVisibleByDateKey) {
			try {
				// Only apply inherited epoch mark coloring if at least one *marked* child record
				// is visible under the current filter set.
				const range = getEpochRangeFromEntry(entry);
				if (range && !epochRangeHasAnyVisibleMarkedChild(range, epochsViewMarkedChildVisibleByDateKey)) {
					inheritedColor = null;
				}
			} catch {
				// ignore
			}
		}
		let baseSummaryColor = colTextBase;
		if (markColor) baseSummaryColor = markColor;
		else if (inheritedColor) baseSummaryColor = inheritedColor;
		else if (isActiveEntry) baseSummaryColor = colRelated;
		const hiddenAlpha = (hiddenVisible || hiddenOnly) ? SUMMARY_HIDDEN_ALPHA : 1;

		const textStartX = x + padX;
		const maxTextWidth = Math.max(0, maxWidth - padX);
		const effectiveText = String(entry.summary || entry.aiSummary || "").trim();
		const hoverT =
			animSummary && animSummary.dayIndex === dayIndex && animSummary.itemIndex === entryIndex
				? clamp01(hoverAnim)
				: outgoingTFor(entryIndex);
		const hoverSummaryColor = baseSummaryColor;

		const baseFont = isDraftItalic ? withFontStyle(fontSmall, "italic") : fontSmall;
		const hoverFont = isDraftItalic ? withFontStyle(fontSmallHover, "italic") : fontSmallHover;
		const rowFont = mixFont(baseFont, hoverFont, hoverT);
		const dropCapsDisabled = disableDropCaps === true;
		const rowLine1FontBaseRaw = dropCapsDisabled ? fontSmall : (fontEpochLine1 || fontSmall);
		const rowLine1FontHoverBaseRaw = dropCapsDisabled ? fontSmallHover : (fontEpochLine1Hover || fontSmallHover);
		const rowLine1FontBase = isDraftItalic ? withFontStyle(rowLine1FontBaseRaw, "italic") : rowLine1FontBaseRaw;
		const rowLine1FontHoverBase = isDraftItalic ? withFontStyle(rowLine1FontHoverBaseRaw, "italic") : rowLine1FontHoverBaseRaw;
		const rowLine1Font = mixFont(rowLine1FontBase, rowLine1FontHoverBase, hoverT);

		const rowFontPx = parseFontPx(rowFont);
		const rowLineHeight = Math.max(baseLineHeight, Math.round(rowFontPx * 1.25));
		const rowLine1FontPx = parseFontPx(rowLine1Font);
		const rowLine1HeightBase = Math.max(rowLineHeight, Math.round(rowLine1FontPx * 1.25));
		const rowLine1Height = dropCapsDisabled
			? rowLine1HeightBase
			: Math.max(rowLine1HeightBase, Math.round(rowLine1FontPx * DROP_CAP_SCALE * 1.08));

		const baseMetrics = measureVerticalMetrics(ctx, rowLine1Font);
		const wrapLine1FontPx = parseFontPx(rowLine1FontBase);
		const dropCapFont = replaceFontPx(rowLine1FontBase, Math.max(wrapLine1FontPx, wrapLine1FontPx * DROP_CAP_SCALE));

		ctx.save();
		// Wrap using the first-line font so epochs view (larger line 1) never overflows.
		ctx.font = rowLine1FontBase;
		let lines = wrapText(ctx, effectiveText, maxTextWidth);
		let dropLineCount = 0;
		let hasDropMixedLine = false;
		let dropMixedPrefix: string | undefined;
		let dropMixedRest: string | undefined;
		if (!dropCapsDisabled) {
			// Drop-cap aware wrapping:
			// - allow the (big-font) prefix to wrap by words onto additional lines
			// - on the last prefix line, put as much of the rest as fits to the right
			// IMPORTANT: preserve explicit user newlines as hard breaks. We apply drop-caps
			// only within the first newline-delimited paragraph, then append remaining
			// paragraphs using normal wrapping.
			try {
				const paragraphs = String(effectiveText || "").split(/\r?\n+/g);
				const firstParagraph = String(paragraphs[0] ?? "").trim();
				const remainder = paragraphs.slice(1).map((p) => String(p ?? "").trim()).filter(Boolean);
				const trimmed = firstParagraph.trimStart();
				const { prefix, rest } = splitLeadByStopWordsOrPunctuation(trimmed, undefined, { fallbackWordsWhenNoPunctuation: 6 });
				if (prefix) {
					ctx.save();
					ctx.font = dropCapFont;
					const prefixLines = wrapText(ctx, prefix, maxTextWidth);
					ctx.restore();

					if (prefixLines.length > 0) {
						dropLineCount = prefixLines.length;
						hasDropMixedLine = !!rest;

						if (!rest) {
							lines = prefixLines;
						} else {
							const lastPrefix = String(prefixLines[prefixLines.length - 1] ?? "");
							ctx.save();
							ctx.font = dropCapFont;
							const lastPrefixW = ctx.measureText(lastPrefix).width;
							ctx.restore();
							const restFirstLineW = Math.max(0, maxTextWidth - (lastPrefixW + 2));
							let firstTokenW = 0;
							try {
								const token = String(rest).trim().split(/\s+/)[0] ?? "";
								if (token) {
									ctx.save();
									ctx.font = rowLine1FontBase;
									firstTokenW = ctx.measureText(token).width;
									ctx.restore();
								}
							} catch {
								try { ctx.restore(); } catch {}
							}

							if (restFirstLineW > 0 && firstTokenW > 0 && restFirstLineW < firstTokenW) {
								hasDropMixedLine = false;
								dropMixedPrefix = undefined;
								dropMixedRest = undefined;
								lines = [...prefixLines, ...wrapText(ctx, rest, maxTextWidth)];
							} else {
								// If the remaining width to the right of the drop-cap prefix is too small,
								// avoid mixing prefix+rest on the same line. Mixing in a narrow space tends
								// to create awkward wraps like breaking before short time tokens (e.g. "3:15")
								// or splitting multi-word title chunks.
								const minRestFirstLineW = Math.max(0, Math.min(220, Math.max(120, Math.floor(maxTextWidth * 0.35))));
								if (restFirstLineW < minRestFirstLineW) {
									hasDropMixedLine = false;
									dropMixedPrefix = undefined;
									dropMixedRest = undefined;
									lines = [...prefixLines, ...wrapText(ctx, rest, maxTextWidth)];
								} else {
								const restLines = wrapTextWithFirstLineWidth(ctx, rest, restFirstLineW, maxTextWidth);
								const firstRest = String(restLines[0] ?? "");
								const needsSpace = !!firstRest && !/^[,.;:!?\])}]/.test(firstRest);
								const joiner = needsSpace ? " " : "";
								dropMixedPrefix = lastPrefix;
								dropMixedRest = firstRest ? `${joiner}${firstRest}` : "";
								const mixedLine = firstRest ? `${lastPrefix}${joiner}${firstRest}` : lastPrefix;

								lines = [...prefixLines.slice(0, -1), mixedLine, ...restLines.slice(1)];
								}
							}
						}
					}
				}

				if (remainder.length > 0) {
					for (const p of remainder) {
						const extra = wrapText(ctx, p, maxTextWidth);
						if (extra.length > 0) lines.push(...extra);
					}
				}
			} catch {
				// ignore
			}
		}
		lines = fixLeadingPunctuationLines(lines);
		ctx.restore();

		let rowLine1Ascent = baseMetrics.ascent;
		let rowLine1Descent = baseMetrics.descent;
		if (lines.length > 0) {
			try {
				const first = String(lines[0] ?? "");
				const trimmed = first.trimStart();
				const { prefix } = splitLeadByStopWordsOrPunctuation(trimmed, undefined, { fallbackWordsWhenNoPunctuation: 6 });
				if (!dropCapsDisabled && prefix) {
					ctx.save();
					ctx.font = dropCapFont;
					const prefixLine = String(prefix).trim();
					const m = ctx.measureText(prefixLine);
					ctx.restore();
					const a = (m as any).actualBoundingBoxAscent;
					const d = (m as any).actualBoundingBoxDescent;
					const ascent = typeof a === "number" && Number.isFinite(a) && a > 0 ? a : 0;
					const descent = typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : 0;
					if (ascent > 0) {
						rowLine1Ascent = Math.max(rowLine1Ascent, ascent);
						rowLine1Descent = Math.max(rowLine1Descent, Math.max(0, descent));
					}
				}
			} catch {
				try {
					ctx.restore();
				} catch {
					// ignore
				}
			}
		}

		const textHeight = Math.max(0, dropLineCount) * rowLine1Height + Math.max(0, lines.length - dropLineCount) * rowLineHeight;
		const height = Math.max(rowHeight, textHeight + padY * 2);
		rows.push({
			entry,
			index: entryIndex,
			lines,
			dropLineCount,
			hasDropMixedLine,
			dropMixedPrefix,
			dropMixedRest,
			height,
			color: baseSummaryColor,
			hoverColor: hoverSummaryColor,
			hoverT,
			hiddenAlpha,
			textStartX,
			maxTextWidth,
			font: rowFont,
			lineHeight: rowLineHeight,
			firstLineFont: rowLine1Font,
			firstLineHeight: rowLine1Height,
			firstLineAscent: Math.max(0, Math.min(rowLine1Ascent, rowLine1Height)),
			firstLineDescent: Math.max(0, Math.min(rowLine1Descent, rowLine1Height))
		});
	}

	let totalHeight = rows.reduce((acc, r) => acc + r.height, 0);
	if (rows.length > 1) {
		for (let ri = 0; ri < rows.length; ri++) {
			const t = Math.max(0, Math.min(1, rows[ri]!.hoverT));
			if (t <= 0) continue;
			const gh = (hoverGap / 2) * t;
			if (ri > 0) totalHeight += gh;
			if (ri < rows.length - 1) totalHeight += gh;
		}
	}

	return { rows, totalHeight, maxWidth, x };
}

export function drawDropCapPrefixLine(
	ctx: CanvasRenderingContext2D,
	label: string,
	x: number,
	y: number,
	baseFont: string,
	dropCapScale: number
): void {
	const t = String(label || "");
	if (!t) return;
	const basePx = parseFontPx(baseFont);
	const dropPx = Math.max(basePx, basePx * dropCapScale);
	const dropFont = replaceFontPx(baseFont, dropPx);
	ctx.save();
	ctx.font = dropFont;
	ctx.fillText(t, x, y);
	ctx.restore();
}

export function drawDropCapPrefixRestLine(
	ctx: CanvasRenderingContext2D,
	prefix: string,
	rest: string,
	x: number,
	y: number,
	baseFont: string,
	dropCapScale: number
): void {
	const basePx = parseFontPx(baseFont);
	const dropPx = Math.max(basePx, basePx * dropCapScale);
	const dropFont = replaceFontPx(baseFont, dropPx);
	ctx.save();
	ctx.font = dropFont;
	ctx.fillText(prefix, x, y);
	const capW = ctx.measureText(prefix).width;
	ctx.font = baseFont;
	if (rest) ctx.fillText(rest, x + capW + 2, y);
	ctx.restore();
}
