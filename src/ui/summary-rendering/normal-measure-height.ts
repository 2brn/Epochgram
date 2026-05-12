import { HOVER_EXTRA_GAP, HOVER_BG_PAD, SUMMARY_MIN_SCALE } from "../epoch-canvas-constants";
import { withFontStyle, withFontWeight } from "../epoch-canvas-utils";
import { estimateDenseBarPartitionCount } from "./dense-height";
import { parseFontPx, wrapTextGreedyWithFirstLineWidth } from "./text";
import { formatPlusNPrefix } from "./plusn";

import type { NormalMeasureArgs } from "./normal-measure-types";
import { buildNormalColumns } from "./normal-measure-build";

export function measureNormalDaySummariesHeight(args: NormalMeasureArgs): number {
	const { entries, xStart, rightWidth } = args;
	if (!entries.length) return 0;
	const disableDraftItalics = false;

	let entriesToMeasure = entries;
	// Zoom-in compact mode renders only the first N rows.
	if (args.scale > SUMMARY_MIN_SCALE && args.compactMode === true) {
		const maxRowSlots = estimateDenseBarPartitionCount({
			scale: args.scale,
			rowHeight: args.rowHeight,
			entryCount: Number.MAX_SAFE_INTEGER
		});
		if (maxRowSlots <= 0) return 0;
		entriesToMeasure = entries.length > maxRowSlots ? entries.slice(0, maxRowSlots) : entries;
		if (!entriesToMeasure.length) return 0;
	}

	const hiddenCount = Math.max(0, entries.length - entriesToMeasure.length);
	const lastVisibleIndex = entriesToMeasure.length > 0 ? entriesToMeasure.length - 1 : -1;
	const plusN = hiddenCount > 0 ? formatPlusNPrefix(hiddenCount + 1) : "";

	const { columns, anyRenderableText, bandHeight, needsDenseByWidth } = buildNormalColumns({
		...args,
		entries: entriesToMeasure,
		decorateTitle:
			plusN && lastVisibleIndex >= 0
				? ({ entryIndex, title }) => (entryIndex === lastVisibleIndex ? `${plusN}${title}` : title)
				: undefined,
		decorateTextToWrap:
			plusN && lastVisibleIndex >= 0
				? ({ entryIndex, textToWrap }) => (entryIndex === lastVisibleIndex ? `${plusN}${textToWrap}` : textToWrap)
				: undefined
	});
	if (!columns.length) return 0;
	if (needsDenseByWidth || !anyRenderableText) return bandHeight;

	const textModeEnabled = args.scale >= SUMMARY_MIN_SCALE && anyRenderableText && !needsDenseByWidth;

	const { ctx, fontSmallHover } = args;
	const rightEdge = xStart + rightWidth;
	let maxHeight = 0;
	for (const col of columns) {
		const rows = col.rows;
		let effectiveColumnHeight = 0;
		for (let i = 0; i < col.rowsThisCol; i++) {
			const r = rows[i]!;
			let h = r.height;
			const hoverT = Math.max(0, Math.min(1, r.summaryHoverT));
			if (textModeEnabled && r.isHoverIncoming && hoverT > 0) {
				const hasAnyText = r.lines.some((l) => l.length > 0);
				if (hasAnyText) {
					let hoverFontStr = fontSmallHover;
					if (r.needsBoldFont) hoverFontStr = withFontWeight(hoverFontStr, "700");
					if (r.isDraft && !disableDraftItalics) hoverFontStr = withFontStyle(hoverFontStr, "italic");
					const baseFontPx = parseFontPx(r.summaryFont);
					const hoverFontPx = parseFontPx(hoverFontStr);
					// Never shrink on hover (notably today+pinned rows).
					if (Number.isFinite(baseFontPx) && Number.isFinite(hoverFontPx) && hoverFontPx + 0.01 < baseFontPx) hoverFontStr = r.summaryFont;

					const textGap = r.leadingIconMetrics.textGap;
					const textStartX = col.x + r.leadingIconMetrics.iconsWidth + textGap;
					const otherLineStartX = r.leadingIconIds.length > 0 ? textStartX : col.x;
					const baseTagGap = r.hasTagIcon ? r.tagIconMetrics.textGap : 0;

					const hoverTagSize = r.hasTagIcon ? r.tagIconMetrics.size : 0;
					const hoverTagExtraWidth = r.hasTagIcon ? baseTagGap + hoverTagSize : 0;

					ctx.save();
					ctx.font = hoverFontStr;
					const firstLineW = Math.max(0, rightEdge - textStartX - hoverTagExtraWidth - HOVER_BG_PAD);
					const otherLinesW = Math.max(0, rightEdge - otherLineStartX - hoverTagExtraWidth - HOVER_BG_PAD);
					const baseCount = Math.max(1, Array.isArray(r.lines) ? r.lines.length : 1);
					const maxCount = baseCount + 1;
					const hoverLinesRaw = wrapTextGreedyWithFirstLineWidth(ctx, r.textToWrap, firstLineW, otherLinesW);
					const hoverLines = hoverLinesRaw.length > maxCount ? hoverLinesRaw.slice(0, maxCount) : hoverLinesRaw;
					ctx.restore();

					const hoverLineHeight = Math.max(12, Math.round(parseFontPx(hoverFontStr) * 1.25));
					const hoverTextHeight = hoverLines.length * hoverLineHeight;
					const hoverHeight = Math.max(args.rowHeight, hoverTextHeight + r.padY * 2);
					h = r.height + ((hoverHeight - r.height) * hoverT);
				}
			}
			effectiveColumnHeight += h;
		}
		if (col.rowsThisCol > 1) {
			for (let i = 0; i < col.rowsThisCol; i++) {
				const t = Math.max(0, Math.min(1, rows[i]!.summaryHoverT));
				if (t <= 0) continue;
				const gh = (HOVER_EXTRA_GAP / 2) * t;
				if (i > 0) effectiveColumnHeight += gh;
				if (i < col.rowsThisCol - 1) effectiveColumnHeight += gh;
			}
		}
		if (effectiveColumnHeight > maxHeight) maxHeight = effectiveColumnHeight;
	}

	return Math.min(Math.max(maxHeight, 0), Math.max(bandHeight, maxHeight));
}
