import type { DateEntry } from "../../indexer/types";
import type { CanvasIconCache } from "../canvas-icon-cache";
import { buildNormalColumns } from "./normal-measure";
import { estimateDenseBarPartitionCount } from "./dense-height";
import type { DaySummaryRenderResult } from "./types";
import { computeHoverLayout } from "./normal/hover-layout";
import { renderNormalColumnsPass } from "./normal/render-pass";
import {
	BASE_SPACING,
	HOVER_EXTRA_GAP,
	HOVER_HIT_PAD,
	SUMMARY_MARGIN,
	SUMMARY_MIN_SCALE,
	SUMMARY_HIDDEN_ALPHA,
	SUMMARY_RECORD_SAFE_MARGIN,
	TOUCH_HIT_PAD
} from "../epoch-canvas-constants";
import { getEntryMarkColor, getInheritedMarkColor } from "./entry-mark-colors";
import { formatPlusNPrefix } from "./plusn";
import { entryFileName, formatEntrySummary, withFontStyle, withFontWeight } from "../epoch-canvas-utils";
import { ellipsizeToWidth } from "./normal/ellipsis";
import type { SummaryRect } from "../epoch-canvas-types";
import type { RenderRow } from "./normal-measure";
import { parseFontPx } from "./text";
import { getHoverFontStrForRow } from "./normal/hover-font";
import { renderNormalRow } from "./normal/render-row";
import { getSummaryIconMetrics } from "../summary-rendering-icons";

type PlusNBadgeCache = {
	entries: DateEntry[];
	visibleCount: number;
	activeFilePath: string | null;
	semanticRelatedPaths: Set<string> | null | undefined;
	markColors: string[] | undefined;
	inheritedMarkIndexByPath: Map<string, number> | null | undefined;
	colHighlight: string;
	colRelated: string;
	color: string | null;
};

const plusNBadgeCacheByDay = new Map<number, PlusNBadgeCache>();

export interface NormalSummaryRenderArgs {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	dayIndex: number;
	dayCenterY: number;
	dayTopBound?: number;
	dayBottomBound?: number;
	viewportTop?: number;
	viewportBottom?: number;
	xStart: number;
	rightWidth: number;
	scale: number;
	compactMode?: boolean;
	rowHeight: number;
	hoverAnim: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	activeFilePath: string | null;
	relatedDateRange?: { start: string; end: string } | null;
	semanticRelatedPaths?: Set<string> | null;
	showHidden: boolean;
	filenameWordsCount: number;
	summaryWordsCount: number;
	iconCache: CanvasIconCache;
	fontSmall: string;
	fontSmallHover: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	pathsWithEmbeddingTerm?: Set<string> | null;
	pathsWithClassifiedTerm?: Set<string> | null;
	termSimilarPaths?: Set<string> | null;
	wrapFadeCache?: Map<string, any> | null;
	getEntryTitle: (entry: DateEntry) => string | null;
}

export function renderNormalDaySummaries(args: NormalSummaryRenderArgs): DaySummaryRenderResult {
	const {
		ctx,
		entries,
		dayIndex,
		dayCenterY,
		dayTopBound,
		dayBottomBound,
		viewportTop,
		viewportBottom,
		xStart,
		rightWidth,
		scale,
		compactMode,
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
		iconCache,
		fontSmallHover,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		wrapFadeCache,
	} = args;
	const disableDraftItalics = false;

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
	const visibleRowIndexRange = (() => {
		if (!(scale > SUMMARY_MIN_SCALE)) return null;
		if (!(entries.length >= 120)) return null;
		const vt = Number(viewportTop);
		const vb = Number(viewportBottom);
		if (!Number.isFinite(vt) || !Number.isFinite(vb)) return null;
		if (!(vb > vt)) return null;
		const dt = Number(dayTopBound);
		const db = Number(dayBottomBound);
		if (!Number.isFinite(dt) || !Number.isFinite(db)) return null;
		// Only apply when the day is partially clipped by the viewport.
		if (!(dt < vt || db > vb)) return null;

		const halfSpan = Math.max(rowHeight / 2, (BASE_SPACING * scale) / 2 - SUMMARY_MARGIN);
		const bandHeight = Math.max(rowHeight, halfSpan * 2);
		const maxRows = Math.max(1, Math.floor(bandHeight / rowHeight));
		const itemsPerCol = Math.max(1, Math.min(maxRows, entries.length));
		const bandTop = dayCenterY - bandHeight / 2;
		const bandBottom = dayCenterY + bandHeight / 2;
		const visTop = Math.max(vt, bandTop);
		const visBottom = Math.min(vb, bandBottom);
		if (!(visBottom > visTop)) return null;

		const bufferRows = 3;
		const start = Math.max(0, Math.floor((visTop - bandTop) / rowHeight) - bufferRows);
		const end = Math.min(itemsPerCol - 1, Math.ceil((visBottom - bandTop) / rowHeight) + bufferRows);
		if (start <= 0 && end >= itemsPerCol - 1) return null;
		return { start, end };
	})();
	const isPartialDayView = visibleRowIndexRange != null;

	// Zoom-in compact mode: triggered by dense conditions (global threshold or per-day overflow).
	// Render the first records that fit (one per row). If there are hidden records,
	// prefix "+789" to the last visible record (count includes the visible record).
	if (scale > SUMMARY_MIN_SCALE && compactMode === true) {
		const maxRowSlots = estimateDenseBarPartitionCount({
			scale,
			rowHeight,
			entryCount: Number.MAX_SAFE_INTEGER
		});
		if (maxRowSlots <= 0) {
			return { summaryRects: [], summaryHoverRects: [], hoverOverlay: null };
		}

		const visibleCount = Math.min(entries.length, maxRowSlots);
		const visibleEntries = entries.slice(0, visibleCount);
		const hiddenCount = Math.max(0, entries.length - visibleCount);
		const lastVisibleIndex = visibleCount > 0 ? visibleCount - 1 : -1;
		const plusN = hiddenCount > 0 ? formatPlusNPrefix(hiddenCount + 1) : "";
		const plusNBadgeColor = (() => {
			if (!plusN || lastVisibleIndex < 0 || hiddenCount <= 0) return null;
			const cached = plusNBadgeCacheByDay.get(dayIndex);
			if (
				cached &&
				cached.entries === entries &&
				cached.visibleCount === visibleCount &&
				cached.activeFilePath === activeFilePath &&
				cached.semanticRelatedPaths === semanticRelatedPaths &&
				cached.markColors === markColors &&
				cached.inheritedMarkIndexByPath === inheritedMarkIndexByPath &&
				cached.colHighlight === colHighlight &&
				cached.colRelated === colRelated
			) {
				return cached.color;
			}

			const hiddenEntries = entries.slice(visibleCount);
			if (hiddenEntries.length === 0) return null;

			let activeHidden: DateEntry | null = null;
			let anyMark: string | null = null;
			let anyInherited: string | null = null;
			let hasSemantic = false;
			if (activeFilePath) {
				for (let i = 0; i < hiddenEntries.length; i++) {
					const e = hiddenEntries[i]!;
					if (e.file === activeFilePath) {
						activeHidden = e;
						break;
					}
				}
			}
			for (let i = 0; i < hiddenEntries.length; i++) {
				const e = hiddenEntries[i]!;
				if (!anyMark) {
					const c = getEntryMarkColor(e, markColors, colHighlight);
					if (c) anyMark = c;
				}
				if (!anyInherited) {
					const c = getInheritedMarkColor(e, markColors, colHighlight, inheritedMarkIndexByPath);
					if (c) anyInherited = c;
				}
				if (!hasSemantic && semanticRelatedPaths && semanticRelatedPaths.has(e.file)) {
					hasSemantic = true;
				}
				if (anyMark && anyInherited && hasSemantic) break;
			}
			const activeMark = activeHidden ? getEntryMarkColor(activeHidden, markColors, colHighlight) : null;
			const activeInherited = activeHidden
				? getInheritedMarkColor(activeHidden, markColors, colHighlight, inheritedMarkIndexByPath)
				: null;
			const color =
				activeMark ||
				activeInherited ||
				anyMark ||
				anyInherited ||
				(activeHidden || hasSemantic ? colRelated : null);

			plusNBadgeCacheByDay.set(dayIndex, {
				entries,
				visibleCount,
				activeFilePath,
				semanticRelatedPaths,
				markColors,
				inheritedMarkIndexByPath,
				colHighlight,
				colRelated,
				color
			});
			if (plusNBadgeCacheByDay.size > 5000) plusNBadgeCacheByDay.clear();
			return color;
		})();

		if (visibleEntries.length === 0) {
			return { summaryRects: [], summaryHoverRects: [], hoverOverlay: null };
		}

		// When compact mode fits ALL rows (no +n), hover/click can become extremely slow if we
		// build/measure thousands of rows per frame. Virtualize: render only the visible slice.
		// This keeps hover/click responsive because hit rects are also limited to the viewport.
		const VIRTUALIZE_ALL_VISIBLE_MIN_ROWS = 200;
		if (hiddenCount === 0 && visibleEntries.length >= VIRTUALIZE_ALL_VISIBLE_MIN_ROWS) {
			const vt = Number(viewportTop);
			const vb = Number(viewportBottom);
			const hasViewport = Number.isFinite(vt) && Number.isFinite(vb) && vb > vt;
			if (hasViewport) {
				const rowH = Math.max(1, Number(rowHeight) || 0);
				const totalRows = visibleEntries.length;
				const baseColumnHeight = totalRows * rowH;
				const yBaseStart = dayCenterY - baseColumnHeight / 2;
				const buffer = 3;
				const start = Math.max(0, Math.floor((vt - yBaseStart) / rowH) - buffer);
				const end = Math.min(totalRows - 1, Math.ceil((vb - yBaseStart) / rowH) + buffer);

				const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
				const hoveredEntryIndex = animSummary && animSummary.dayIndex === dayIndex ? animSummary.itemIndex : -1;
				const hoveredT = hoveredEntryIndex >= 0 ? clamp01(hoverAnim) : 0;
				let outgoingEntryIndex = -1;
				let outgoingT = 0;
				if (Array.isArray(outgoingSummaries) && outgoingSummaries.length) {
					for (let i = 0; i < outgoingSummaries.length; i++) {
						const o = outgoingSummaries[i]!;
						if (o.dayIndex !== dayIndex) continue;
						const t = clamp01(Number(o.t));
						if (t > outgoingT + 1e-6) {
							outgoingT = t;
							outgoingEntryIndex = o.itemIndex;
						}
					}
				}
				const recordSafeGap = HOVER_EXTRA_GAP + SUMMARY_RECORD_SAFE_MARGIN;
				const hoverIsVisible = hoveredEntryIndex >= start && hoveredEntryIndex <= end;
				const hoverTForVisible = hoverIsVisible ? hoveredT : 0;
				const outgoingIsVisible = outgoingEntryIndex >= start && outgoingEntryIndex <= end;
				const outgoingTForVisible = outgoingIsVisible ? outgoingT : 0;
				const allowPartialReflow = !isPartialDayView;

				// Centering should match normal hover layout: only the hovered row can add height/gaps.
				let effectiveColumnHeight = baseColumnHeight;
				let hoveredHoverHeight = rowH;
				let hoveredGapAbove = 0;
				let hoveredGapBelow = 0;
				if (allowPartialReflow && hoverTForVisible > 0.001 && hoveredEntryIndex >= 0 && hoveredEntryIndex < totalRows) {
					// Mirror normal hover height logic for a single-line row.
					let font = args.fontSmall;
					const hoveredEntry = visibleEntries[hoveredEntryIndex]!;
					const isActiveEntry = !!(activeFilePath && hoveredEntry.file === activeFilePath);
					const isDraft = hoveredEntry.reviewState === "draft";
					if (isActiveEntry) font = withFontWeight(font, "700");
					if (isDraft && !disableDraftItalics) font = withFontStyle(font, "italic");
					const baseFont = font;
					const needsBoldFont = isActiveEntry;
					const hoverFontStr = getHoverFontStrForRow(
						{ summaryFont: baseFont, needsBoldFont, isDraft: isDraft && !disableDraftItalics },
						args.fontSmallHover
					);
					const hoverLineHeight = Math.max(12, Math.round(parseFontPx(hoverFontStr) * 1.25));
					const padY = 4;
					hoveredHoverHeight = Math.max(rowH, hoverLineHeight + padY * 2);
					const deltaH = (hoveredHoverHeight - rowH) * hoverTForVisible;
					const gh = (recordSafeGap / 2) * hoverTForVisible;
					hoveredGapAbove = hoveredEntryIndex > 0 ? gh : 0;
					hoveredGapBelow = hoveredEntryIndex < totalRows - 1 ? gh : 0;
					effectiveColumnHeight += deltaH + hoveredGapAbove + hoveredGapBelow;
				}
				// Intentionally avoid outgoing hover-out reflow in compact virtualization.
				// Outgoing animations are rendered without layout changes to prevent visible
				// word/ellipsis shifts during fade-out.
				const yEffectiveStart = dayCenterY - effectiveColumnHeight / 2;

				const summaryRects: SummaryRect[] = [];
				const summaryHoverRects: SummaryRect[] = [];
				const rightEdge = xStart + rightWidth;

				// Render only the visible slice, but with the same hover behavior (font growth + row expansion)
				// as normal summaries.
				ctx.save();
				ctx.textAlign = "left";
				ctx.textBaseline = "top";
				const maxTextW = Math.max(0, rightEdge - xStart - 4);
				let yCursor = (allowPartialReflow ? yEffectiveStart : yBaseStart) + start * rowH;
				for (let row = start; row <= end; row++) {
					const entry = visibleEntries[row]!;
					const rowT = row === hoveredEntryIndex ? hoverTForVisible : (row === outgoingEntryIndex ? outgoingTForVisible : 0);
					const baseYRectTop = yBaseStart + row * rowH;
					const baseYRectBottom = baseYRectTop + rowH;

					// Apply the same hover gaps rules as normal layout, but only when the hovered row
					// is within the rendered slice.
					if (allowPartialReflow && rowT > 0.001) {
						if (row > 0) yCursor += hoveredGapAbove;
					}
					const yRectTop = allowPartialReflow ? yCursor : baseYRectTop;
					const hoverHeight = row === hoveredEntryIndex || row === outgoingEntryIndex ? hoveredHoverHeight : rowH;
					const effectiveH = allowPartialReflow ? (rowH + (hoverHeight - rowH) * rowT) : rowH;
					const yRectBottom = yRectTop + effectiveH;
					const isAnchor = rowT > 0.001;
					const yItemCenter = isAnchor ? (baseYRectTop + baseYRectBottom) / 2 : (yRectTop + yRectBottom) / 2;
					const yCenter = yItemCenter;

					let font = args.fontSmall;
					const isActiveEntry = !!(activeFilePath && entry.file === activeFilePath);
					const isDraft = entry.reviewState === "draft";
					if (isActiveEntry) font = withFontWeight(font, "700");
					if (isDraft && !disableDraftItalics) font = withFontStyle(font, "italic");
					ctx.font = font;
					const rawTitle = args.getEntryTitle(entry) || entryFileName(entry);
					const title = String(rawTitle || "")
						.replace(/\.md$/i, "")
						.trim() || String(entryFileName(entry) || entry.file || "").replace(/\.md$/i, "");
					const displaySummary = (formatEntrySummary(entry, {
						fallbackToFileName: true,
						includeIcons: false,
					filenameWordsCount: filenameWordsCount,
					summaryWordsCount: summaryWordsCount
					}) || "").trim();
					const isFallbackSummary = (displaySummary === title);
					const effectiveSummary = isFallbackSummary ? "" : displaySummary;
					const textToWrap = effectiveSummary.length > 0 ? effectiveSummary : displaySummary || title;
					const label = ellipsizeToWidth(ctx, textToWrap, maxTextW);
					const lineHeight = Math.max(12, Math.round(parseFontPx(font) * 1.25));

					const r: RenderRow = {
						entryIndex: row,
						entry,
						height: rowH,
						lines: [label],
						lineHeight,
						maxLineWidth: label ? ctx.measureText(label).width : 0,
						textToWrap: label,
						maxTextWidth: maxTextW,
						summaryHoverT: rowT,
						isHoverTarget: row === hoveredEntryIndex || row === outgoingEntryIndex,
						isHoverIncoming: row === hoveredEntryIndex,
						isActiveEntry,
						summaryFont: font,
						needsBoldFont: isActiveEntry,
						isDraft,
						padY: 4,
						baseColor: (() => {
							const isRelatedEntry = isRelatedDate(entry.date);
							const isSemanticRelatedEntry = !!(semanticRelatedPaths && semanticRelatedPaths.has(entry.file));
							const markColor = getEntryMarkColor(entry, markColors, colHighlight);
							const inheritedColor = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
							if (markColor) return markColor;
							if (inheritedColor) return inheritedColor;
							if (isActiveEntry || isRelatedEntry || isSemanticRelatedEntry) return colRelated;
							return colTextBase;
						})(),
						// Match normal (non-compact) behavior: hover changes size/packing, not color.
						hoverSummaryColor: (() => {
							const isRelatedEntry = isRelatedDate(entry.date);
							const isSemanticRelatedEntry = !!(semanticRelatedPaths && semanticRelatedPaths.has(entry.file));
							const markColor = getEntryMarkColor(entry, markColors, colHighlight);
							const inheritedColor = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
							if (markColor) return markColor;
							if (inheritedColor) return inheritedColor;
							if (isActiveEntry || isRelatedEntry || isSemanticRelatedEntry) return colRelated;
							return colTextBase;
						})(),
						hiddenAlpha: entry.reviewState === "hidden" && showHidden ? SUMMARY_HIDDEN_ALPHA : 1,
						leadingIconIds: [],
						tagTint: false,
						hasTagIcon: false,
						leadingIconMetrics: getSummaryIconMetrics(0, rowH),
						tagIconMetrics: getSummaryIconMetrics(0, rowH),
						title
					};

					renderNormalRow({
						ctx,
						r,
						iconCache,
						fontSmallHover: args.fontSmallHover,
						textModeEnabled: true,
						xStart,
						rowX: xStart,
						yItemCenter: yCenter,
						yRectTop,
						yRectBottom,
						maxWidth: rightWidth,
						clipRight: rightEdge,
						rowT
					});

					summaryRects.push({
						x1: xStart - TOUCH_HIT_PAD,
						y1: yRectTop - TOUCH_HIT_PAD,
						x2: rightEdge + TOUCH_HIT_PAD,
						y2: yRectBottom + TOUCH_HIT_PAD,
						itemIndex: row,
						entry
					});
					summaryHoverRects.push({
						x1: xStart - HOVER_HIT_PAD,
						y1: baseYRectTop - HOVER_HIT_PAD,
						x2: rightEdge + HOVER_HIT_PAD,
						y2: baseYRectBottom + HOVER_HIT_PAD,
						itemIndex: row,
						entry
					});

					yCursor = allowPartialReflow ? yRectBottom : (baseYRectTop + rowH);
					if (allowPartialReflow && rowT > 0.001) {
						if (row < totalRows - 1) yCursor += hoveredGapBelow;
					}
				}
				ctx.restore();
				return { summaryRects, summaryHoverRects, hoverOverlay: null };
			}
		}

		const measured = buildNormalColumns({
			...args,
			entries: visibleEntries,
			visibleRowIndexRange,
			decorateTitle:
				plusN && lastVisibleIndex >= 0
					? ({ entryIndex, title }) => (entryIndex === lastVisibleIndex ? `${plusN}${title}` : title)
					: undefined,
			decorateTextToWrap:
				plusN && lastVisibleIndex >= 0
					? ({ entryIndex, textToWrap }) => (entryIndex === lastVisibleIndex ? `${plusN}${textToWrap}` : textToWrap)
					: undefined,
			decoratePlusNBadgeColor:
				plusNBadgeColor && lastVisibleIndex >= 0
					? ({ entryIndex }) => (entryIndex === lastVisibleIndex ? plusNBadgeColor : null)
					: undefined
		});
		const { columns, anyRenderableText, needsDenseByWidth } = measured;
		if (!columns.length) {
			return { summaryRects: [], summaryHoverRects: [], hoverOverlay: null };
		}

		const hoverLayout = computeHoverLayout({
			ctx,
			columns,
			dayIndex,
			dayCenterY,
			xStart,
			rightWidth,
			scale,
			rowHeight,
			animSummary,
			fontSmallHover,
			allowRightColumnShift: !isPartialDayView,
			allowVerticalNeighborShift: !isPartialDayView,
			allowRowHeightExpansion: !isPartialDayView
		});

		// At zoom-in, never render placeholder strokes. If width is too narrow to render even an
		// ellipsis, text rendering will naturally become empty/clipped.
		const effectiveTextModeEnabled =
			hoverLayout.textModeEnabled && anyRenderableText && (scale > SUMMARY_MIN_SCALE ? true : !needsDenseByWidth);
		const rendered = renderNormalColumnsPass({
			ctx,
			columns,
			dayIndex,
			dayCenterY,
			xStart,
			rightWidth,
			rowHeight,
			iconCache,
			fontSmallHover,
			wrapFadeCache,
			viewportTop,
			viewportBottom,
			textModeEnabled: effectiveTextModeEnabled,
			detailHoverScale: hoverLayout.detailHoverScale,
			hoveredColIdx: hoverLayout.hoveredColIdx,
			hoveredRowIdx: hoverLayout.hoveredRowIdx,
			hoveredT: hoverLayout.hoveredT,
			shiftRightDx: hoverLayout.shiftRightDx,
			recordSafeGap: hoverLayout.recordSafeGap,
			rowLayoutByCol: hoverLayout.rowLayoutByCol
		});

		if (hiddenCount > 0 && lastVisibleIndex >= 0) {
			for (const rect of rendered.summaryRects) {
				if (rect.itemIndex !== lastVisibleIndex) continue;
				(rect as any).compactTotalCount = entries.length;
				(rect as any).compactHiddenCount = hiddenCount;
				break;
			}
			for (const rect of rendered.summaryHoverRects) {
				if (rect.itemIndex !== lastVisibleIndex) continue;
				(rect as any).compactTotalCount = entries.length;
				(rect as any).compactHiddenCount = hiddenCount;
				break;
			}
		}
		return { summaryRects: rendered.summaryRects, summaryHoverRects: rendered.summaryHoverRects, hoverOverlay: null };
	}

	const { columns, anyRenderableText, needsDenseByWidth } = buildNormalColumns({
		...args,
		visibleRowIndexRange
	});
	// Zoom-in: if a day is too narrow to render even an ellipsis, treat it as compact.
	// This avoids any placeholder fallback at zoom-in and keeps behavior consistent.
	if (scale > SUMMARY_MIN_SCALE && compactMode !== true && (needsDenseByWidth || !anyRenderableText)) {
		return renderNormalDaySummaries({
			...args,
			compactMode: true
		});
	}
	// Zoomed-out: if text can't render (or row is too narrow), the row renderer will draw placeholders.
	// Dense bars are handled upstream (draw-days) only at or below SUMMARY_MIN_SCALE.

	const hoverLayout = computeHoverLayout({
		ctx,
		columns,
		dayIndex,
		dayCenterY,
		xStart,
		rightWidth,
		scale,
		rowHeight,
		animSummary,
		fontSmallHover,
		allowRightColumnShift: !isPartialDayView,
		allowVerticalNeighborShift: !isPartialDayView,
		allowRowHeightExpansion: !isPartialDayView
	});

	const rendered = renderNormalColumnsPass({
		ctx,
		columns,
		dayIndex,
		dayCenterY,
		xStart,
		rightWidth,
		rowHeight,
		iconCache,
		fontSmallHover,
		wrapFadeCache,
		viewportTop,
		viewportBottom,
		textModeEnabled: hoverLayout.textModeEnabled && anyRenderableText && (scale > SUMMARY_MIN_SCALE ? true : !needsDenseByWidth),
		detailHoverScale: hoverLayout.detailHoverScale,
		hoveredColIdx: hoverLayout.hoveredColIdx,
		hoveredRowIdx: hoverLayout.hoveredRowIdx,
		hoveredT: hoverLayout.hoveredT,
		shiftRightDx: hoverLayout.shiftRightDx,
		recordSafeGap: hoverLayout.recordSafeGap,
		rowLayoutByCol: hoverLayout.rowLayoutByCol
	});

	// Normal view renders hover inline (no overlay background).
	return { summaryRects: rendered.summaryRects, summaryHoverRects: rendered.summaryHoverRects, hoverOverlay: null };
}
