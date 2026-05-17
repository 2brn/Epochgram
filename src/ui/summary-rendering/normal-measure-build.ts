import {
	BASE_SPACING,
	SUMMARY_COLUMN_GAP,
	SUMMARY_HIDDEN_ALPHA,
	SUMMARY_MARGIN,
	SUMMARY_MAX_COL_WIDTH,
	SUMMARY_MIN_SCALE,
	SUMMARY_SEPARATOR_SYMBOL
} from "../epoch-canvas-constants";
import {
	entryFileName,
	entrySummaryComponents,
	formatEntrySummary,
	truncateHard,
	withFontStyle,
	withFontWeight
} from "../epoch-canvas-utils";
import { formatDate } from "utils";
import { getSummaryIconMetrics } from "../summary-rendering-icons";
import { getEntryMarkColor, getInheritedMarkColor } from "./entry-mark-colors";
import { parseFontPx, wrapText } from "./text";
import { splitPlusNPrefix } from "./plusn";

import type { NormalMeasureArgs, RenderColumn, RenderRow } from "./normal-measure-types";

export function buildNormalColumns(args: NormalMeasureArgs): {
	columns: RenderColumn[];
	anyRenderableText: boolean;
	bandHeight: number;
	needsDenseByWidth: boolean;
} {
	const {
		ctx,
		entries,
		dayIndex,
		xStart,
		rightWidth,
		scale,
		rowHeight,
		hoverAnim,
		animSummary,
		outgoingSummaries,
		activeFilePath,
		relatedDateRange,
		semanticRelatedPaths,
		showHidden,
		filenameWordsCount,
		summaryWordsCount,
		fontSmall,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		pathsWithEmbeddingTerm,
		pathsWithClassifiedTerm,
		termSimilarPaths,
		getEntryTitle,
		decorateTitle,
		decorateTextToWrap,
		decoratePlusNBadgeColor,
		visibleRowIndexRange
	} = args;

	// Conservative ellipsis width used by cheap (uncached) dense-by-width checks.
	ctx.save();
	ctx.font = withFontWeight(fontSmall, "700");
	const ellWBold = ctx.measureText("ΓÇª").width;
	ctx.restore();

	const isRelatedDate = (dateKey: string): boolean => {
		const r = relatedDateRange;
		if (!r) return false;
		const start = r.start;
		const end = r.end;
		if (!start || !end) return false;
		const lo = start <= end ? start : end;
		const hi = start <= end ? end : start;
		return dateKey >= lo && dateKey <= hi;
	};

	const halfSpan = Math.max(rowHeight / 2, (BASE_SPACING * scale) / 2 - SUMMARY_MARGIN);
	const bandHeight = Math.max(rowHeight, halfSpan * 2);
	const maxRows = Math.max(1, Math.floor(bandHeight / rowHeight));
	const itemsPerCol = Math.max(1, Math.min(maxRows, entries.length));
	const columnCount = Math.ceil(entries.length / itemsPerCol);
	const compactMinWidthRatioRaw = Number(args.compactMinWidthRatio ?? 0);
	const compactMinWidthRatio = Number.isFinite(compactMinWidthRatioRaw)
		? Math.max(0, Math.min(1, compactMinWidthRatioRaw))
		: 0;
	const compactMinWidthBaseWidthRaw = Number(args.compactMinWidthBaseWidth ?? rightWidth);
	const compactMinWidthBaseWidth = Number.isFinite(compactMinWidthBaseWidthRaw) && compactMinWidthBaseWidthRaw > 0
		? compactMinWidthBaseWidthRaw
		: rightWidth;
	const compactMinWidthPx = scale > SUMMARY_MIN_SCALE ? compactMinWidthBaseWidth * compactMinWidthRatio : 0;

	const colWidth = Math.min(
		SUMMARY_MAX_COL_WIDTH,
		(rightWidth - (columnCount - 1) * SUMMARY_COLUMN_GAP) / columnCount
	);

	ctx.textAlign = "left";

	const columns: RenderColumn[] = [];
	let anyRowTooNarrowForEllipsis = false;
	let sawAnyRow = false;

	for (let col = 0; col < columnCount; col++) {
		const startIndex = col * itemsPerCol;
		if (startIndex >= entries.length) break;
		const endIndex = Math.min(startIndex + itemsPerCol, entries.length);
		const rowsThisCol = endIndex - startIndex;

		const incomingHoverEntryIndex =
			animSummary && animSummary.dayIndex === dayIndex && Number.isFinite(animSummary.itemIndex)
				? animSummary.itemIndex
				: -1;
		const incomingHoverRowInThisCol =
			incomingHoverEntryIndex >= startIndex && incomingHoverEntryIndex < endIndex ? incomingHoverEntryIndex - startIndex : -1;

		const x = xStart + col * (colWidth + SUMMARY_COLUMN_GAP);
		const isLastCol = col === columnCount - 1;
		const rightEdge = xStart + rightWidth;
		const maxWidth = Math.max(0, (isLastCol ? (rightEdge - x) : colWidth) - 4);
		const padY = 4;

		const rows: RenderRow[] = [];
		const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
		let bestOutgoingItemIndex = -1;
		let bestOutgoingT = 0;
		if (Array.isArray(outgoingSummaries) && outgoingSummaries.length) {
			for (let i = 0; i < outgoingSummaries.length; i++) {
				const o = outgoingSummaries[i]!;
				if (o.dayIndex !== dayIndex) continue;
				const t = clamp01(Number(o.t));
				if (t > bestOutgoingT + 1e-6) {
					bestOutgoingT = t;
					bestOutgoingItemIndex = o.itemIndex;
				}
			}
		}
		const hasVisibleRange = !!(
			visibleRowIndexRange &&
			Number.isFinite(visibleRowIndexRange.start) &&
			Number.isFinite(visibleRowIndexRange.end)
		);
		const visibleStart = hasVisibleRange ? Math.max(0, Math.min(rowsThisCol - 1, visibleRowIndexRange!.start)) : 0;
		const visibleEnd = hasVisibleRange ? Math.max(0, Math.min(rowsThisCol - 1, visibleRowIndexRange!.end)) : rowsThisCol - 1;

		for (let row = 0; row < rowsThisCol; row++) {
			const entryIndex = startIndex + row;
			const entry = entries[entryIndex]!;
			const isNearIncomingHoverRow = incomingHoverRowInThisCol >= 0 && Math.abs(row - incomingHoverRowInThisCol) <= 1;
			const shouldMeasureText = !hasVisibleRange || (row >= visibleStart && row <= visibleEnd) || isNearIncomingHoverRow;
			const isIncomingHoverTarget = !!(animSummary && animSummary.dayIndex === dayIndex && animSummary.itemIndex === entryIndex);
			const outgoingT = entryIndex === bestOutgoingItemIndex ? bestOutgoingT : 0;
			const summaryHoverT = isIncomingHoverTarget ? clamp01(hoverAnim) : outgoingT;
			const isHoverTarget = isIncomingHoverTarget || outgoingT > 0.001;
			const isHoverIncoming = isIncomingHoverTarget;

			const isActiveEntry = !!(activeFilePath && entry.file === activeFilePath);
			const isRelatedEntry = isRelatedDate(entry.date);
			const isSemanticRelatedEntry = !!(semanticRelatedPaths && semanticRelatedPaths.has(entry.file));
			const isPinnedEntry = entry.pinned === true;
			const isHiddenEntry = entry.reviewState === "hidden";
			const hiddenVisible = showHidden && isHiddenEntry;
			const markColor = getEntryMarkColor(entry, markColors, colHighlight);
			const inheritedColor = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
			let baseSummaryColor = colTextBase;
			if (markColor) baseSummaryColor = markColor;
			else if (inheritedColor) baseSummaryColor = inheritedColor;
			else if (isActiveEntry || isRelatedEntry || isSemanticRelatedEntry) baseSummaryColor = colRelated;
			const hiddenAlpha = hiddenVisible ? SUMMARY_HIDDEN_ALPHA : 1;
			const summaryColor = baseSummaryColor;
			const hoverSummaryColor = summaryColor;

			const summaryComponents = entrySummaryComponents(entry);
			const summaryBase = summaryComponents.base;
			const iconIds = summaryComponents.iconIds.slice().filter((id) => id !== "tag");

			const hasOwnTerm =
				!!(!entry.file.startsWith("epoch://") && pathsWithEmbeddingTerm instanceof Set && pathsWithEmbeddingTerm.has(entry.file));
			const hasInferredTerm =
				!!(!entry.file.startsWith("epoch://") && pathsWithClassifiedTerm instanceof Set && pathsWithClassifiedTerm.has(entry.file));
			const isTermSimilar = !!(termSimilarPaths instanceof Set && termSimilarPaths.has(entry.file));
			const tagTint = hasOwnTerm || hasInferredTerm || isTermSimilar;
			const leadingIconIds = iconIds;
			const leadingIconMetrics = getSummaryIconMetrics(leadingIconIds.length, rowHeight);
			const tagIconMetrics = getSummaryIconMetrics(0, rowHeight);

			const todayKey = formatDate(new Date());
			const isTodayEntry = entry.date === todayKey;
			const needsBoldFont = isActiveEntry || (isPinnedEntry && isTodayEntry);
			const isDraft = entry.reviewState === "draft";
			const disableDraftItalics = false;
			let summaryFont = needsBoldFont ? withFontWeight(fontSmall, "700") : fontSmall;
			if (isDraft && !disableDraftItalics) summaryFont = withFontStyle(summaryFont, "italic");

			const suffixReserve = 0;
			const rightEdge = xStart + rightWidth;
			const textStartX = x + leadingIconMetrics.iconsWidth + (leadingIconMetrics.totalWidth > 0 ? leadingIconMetrics.textGap : 0);
			const maxTextWidth = Math.max(0, rightEdge - textStartX - suffixReserve);
			sawAnyRow = true;
			if (maxTextWidth <= ellWBold + 0.5 || (compactMinWidthPx > 0 && maxTextWidth <= compactMinWidthPx + 0.5)) {
				anyRowTooNarrowForEllipsis = true;
			}

			if (!shouldMeasureText) {
				rows.push({
					entryIndex,
					entry,
					height: rowHeight,
					lines: [""],
					lineHeight: Math.max(12, Math.round(parseFontPx(summaryFont) * 1.25)),
					maxLineWidth: 0,
					textToWrap: "",
					maxTextWidth,
					summaryHoverT: 0,
					isHoverTarget: false,
					isHoverIncoming: false,
					isActiveEntry,
					summaryFont,
					needsBoldFont,
					isDraft: isDraft && !disableDraftItalics,
					padY,
					baseColor: summaryColor,
					hoverSummaryColor,
					hiddenAlpha,
					leadingIconIds: [],
					tagTint,
					hasTagIcon: false,
					leadingIconMetrics: getSummaryIconMetrics(0, rowHeight),
					tagIconMetrics: getSummaryIconMetrics(0, rowHeight),
					title: ""
				});
				continue;
			}

			const rawTitle = getEntryTitle(entry) || entryFileName(entry);
			let title =
				(rawTitle || "").replace(/\.md$/i, "").trim() ||
				(entryFileName(entry) || entry.file || "").replace(/\.md$/i, "");
			if (decorateTitle) {
				title = decorateTitle({ entryIndex, entry, title });
			}
			const displaySummary =
				(
					formatEntrySummary(entry, {
						fallbackToFileName: true,
						includeIcons: false,
						filenameWordsCount: filenameWordsCount,
						summaryWordsCount: summaryWordsCount
					}) ||
					""
				).trim();
			const hasIcons = iconIds.length > 0;
			const isFallbackSummary =
				!hasIcons &&
				((summaryBase.length > 0 && summaryBase === title) || (summaryBase.length === 0 && displaySummary === title));
			const effectiveSummary = isFallbackSummary ? "" : displaySummary;

			ctx.save();
			ctx.font = summaryFont;
			let textToWrap = effectiveSummary.length > 0 ? effectiveSummary : displaySummary || title;
			if (decorateTextToWrap) {
				textToWrap = decorateTextToWrap({ entryIndex, entry, title, effectiveSummary, textToWrap });
			}
			const plusNBadgeColor = (() => {
				if (!decoratePlusNBadgeColor) return null;
				if (!splitPlusNPrefix(textToWrap) && !splitPlusNPrefix(title)) return null;
				return decoratePlusNBadgeColor({ entryIndex, entry, textToWrap, title });
			})();
			const linesRaw = wrapText(ctx, textToWrap, maxTextWidth);
			let maxLineWidth = 0;
			for (const line of linesRaw) {
				const w = ctx.measureText(line).width;
				if (w > maxLineWidth) maxLineWidth = w;
			}
			const lineHeight = Math.max(12, Math.round(parseFontPx(summaryFont) * 1.25));
			const ellW = ctx.measureText("ΓÇª").width;
			if (maxTextWidth <= ellW + 0.5 || (compactMinWidthPx > 0 && maxTextWidth <= compactMinWidthPx + 0.5)) {
				anyRowTooNarrowForEllipsis = true;
			}
			const lines = linesRaw;
			const textHeight = Math.max(0, lines.length) * lineHeight;
			const height = Math.max(rowHeight, textHeight + padY * 2);
			ctx.restore();

			rows.push({
				entryIndex,
				entry,
				height,
				lines,
				lineHeight,
				maxLineWidth,
				textToWrap,
				maxTextWidth,
				summaryHoverT,
				isHoverTarget,
				isHoverIncoming,
				isActiveEntry,
				summaryFont,
				needsBoldFont,
				isDraft: isDraft && !disableDraftItalics,
				padY,
				baseColor: summaryColor,
				hoverSummaryColor,
				plusNBadgeColor,
				hiddenAlpha,
				leadingIconIds,
				tagTint,
				hasTagIcon: false,
				leadingIconMetrics,
				tagIconMetrics,
				title
			});
		}

		const baseColumnHeight = rowsThisCol * rowHeight;
		let columnHeight = rows.reduce((acc, r) => acc + r.height, 0);
		let forcedSingleLine = false;

		if (columnHeight > bandHeight && baseColumnHeight <= bandHeight) {
			const endsWithDanglingSummarySeparator = (value: string): boolean => {
				const idx = value.lastIndexOf(SUMMARY_SEPARATOR_SYMBOL);
				if (idx < 0) return false;
				const tail = value.slice(idx + SUMMARY_SEPARATOR_SYMBOL.length).trim();
				return tail.length === 0 || /^[.]+$/.test(tail);
			};

			const plusNPrefix = (value: string): string => {
				const split = splitPlusNPrefix(value);
				return split ? `${split.prefix} ` : "";
			};

			ctx.save();
			for (const r of rows) {
				ctx.font = r.summaryFont;
				const prefix = plusNPrefix(r.textToWrap);
				let label = r.maxTextWidth > 0 ? truncateHard(r.textToWrap, r.maxTextWidth, ctx) : "";
				if (endsWithDanglingSummarySeparator(label)) {
					label = r.maxTextWidth > 0 ? truncateHard(`${prefix}${r.title}`, r.maxTextWidth, ctx) : `${prefix}${r.title}`;
				}
				r.lines = [label];
				r.maxLineWidth = label ? ctx.measureText(label).width : 0;
				r.lineHeight = Math.max(12, Math.round(parseFontPx(r.summaryFont) * 1.25));
				r.height = rowHeight;
			}
			ctx.restore();
			columnHeight = baseColumnHeight;
			forcedSingleLine = true;
		}

		columns.push({ x, maxWidth, rowsThisCol, rows, columnHeight, baseColumnHeight, forcedSingleLine });
	}

	const anyRenderableText = columns.some((col) => col.rows.some((r) => r.lines.some((line) => line.length > 0)));
	const needsDenseByWidth = sawAnyRow && anyRowTooNarrowForEllipsis;
	return { columns, anyRenderableText, bandHeight, needsDenseByWidth };
}
