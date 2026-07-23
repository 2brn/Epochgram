import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import { renderDaySummaries } from "../summary-rendering";
import { buildNormalColumns, computeNeedsDenseByWidthFast } from "../summary-rendering/normal-measure";
import { estimateDenseBarPartitionCount } from "../summary-rendering/dense-height";
import {
	buildDenseSummaryRects,
	computeDenseBarVisual,
	drawDenseBarBase,
	drawDenseBarHover,
	type DenseBarVisual
} from "../summary-rendering/dense";
import {
	BASE_SPACING,
	DATE_RECT_HALF_HEIGHT,
	DATE_RECT_RIGHT_EXTRA,
	DAY_LABEL_MIN_SCALE,
	HOVER_HIT_PAD,
	LABEL_OFFSET_X,
	SUMMARY_COLUMN_GAP,
	SUMMARY_MARGIN,
	SUMMARY_MAX_COL_WIDTH,
	SUMMARY_MIN_SCALE,
	SUMMARY_MIN_WIDTH,
	SUMMARY_OFFSET_X,
	SUMMARY_PLACEHOLDER_STROKE_WIDTH,
	SUMMARY_RIGHT_MARGIN,
	TIMELINE_X
} from "../epoch-canvas-constants";
import { getPinBadgeRects, type PinBadgeRect } from "../epoch-pin-overlay";
import { getEpochMarkColorSet } from "../mark-colors";
import { drawDayMarker } from "./draw-days/date-marker";
import type { CanvasDrawState } from "./state";
import type { DaySummaryRenderArgs } from "../summary-rendering/types";

type DateRangeFilter = DaySummaryRenderArgs["relatedDateRange"];
type AnimSummaryState = DaySummaryRenderArgs["animSummary"];
type PrevAnimSummaryState = DaySummaryRenderArgs["prevAnimSummary"];
type OutgoingSummariesState = DaySummaryRenderArgs["outgoingSummaries"];

type DateLabelHideState = { hidden: boolean; changedAt: number };
const dateLabelHideStateByCanvas = new WeakMap<CanvasDrawState, Map<number, DateLabelHideState>>();

function rectsOverlap(a: PinBadgeRect, b: PinBadgeRect): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function shouldHideDateLabelByPinOverlap(yScreen: number, pinRects: PinBadgeRect[], tolerance: number): boolean {
	if (!Array.isArray(pinRects) || pinRects.length === 0) return false;
	const dateRect: PinBadgeRect = {
		x1: TIMELINE_X - (LABEL_OFFSET_X + 40) - tolerance,
		y1: yScreen - DATE_RECT_HALF_HEIGHT - tolerance,
		x2: TIMELINE_X + DATE_RECT_RIGHT_EXTRA + tolerance,
		y2: yScreen + DATE_RECT_HALF_HEIGHT + tolerance
	};
	for (const badge of pinRects) {
		if (rectsOverlap(dateRect, badge)) return true;
	}
	return false;
}

export function drawDayLayouts(params: {
	s: CanvasDrawState;
	w: number;
	h: number;
	today: Date;
	renderIndices: number[];
	entriesByIndex: Map<number, DateEntry[]>;
	prevEntriesByIndex: Map<number, DateEntry[]>;
	epochsViewActive: boolean;
	prevEpochBucket: string | null;
	bucketFadeT: number;
	recordOpacity: number;
	rowHeight: number;
	hoverGap: number;
	ctx: CanvasRenderingContext2D;
	fontMain: string;
	fontMainHover: string;
	fontSmall: string;
	fontSmallHover: string;
	fontEpochLine1?: string;
	fontEpochLine1Hover?: string;
	colTextBase: string;
	colTextHover: string;
	colToday: string;
	colSummaryHoverBg: string;
	colRelated: string;
	colHighlight: string;
	activePath: string | null;
	relatedDateRange: DateRangeFilter;
	semanticRelatedPaths: Set<string> | null;
	semanticRelatedTermPaths: Set<string> | null;
	semanticRelatedActiveTerm: string | null;
	inheritedMarkIndexByPath: Map<string, number> | null;
	epochsViewMarkedChildVisibleByDateKey: Map<string, boolean> | null;
	wrapFadeCache: Map<string, unknown>;
	packedEpochDayCenterY: Map<number, number>;
	epochPackAlphaByIndex: Map<number, number> | null;
	packedNormalDayCenterY: Map<number, number>;
	hoverAnimEffective: number;
	animSummaryEffective: AnimSummaryState;
	prevAnimSummaryEffective: PrevAnimSummaryState;
	outgoingSummariesEffective: OutgoingSummariesState;
	globalDenseMode: boolean;
	globalCompactMode: boolean;
	perDayDenseByIndex: Map<number, boolean>;
	denseBarHeightByIndex: Map<number, number>;
	rightWidthForText: number;
	xStart: number;
}): {
	layouts: DayLayout[];
	hoverOverlay: HoverOverlay | null;
	denseBarsToDraw: DenseBarVisual[];
} {
	const {
		s,
		w,
		h,
		today,
		renderIndices,
		entriesByIndex,
		prevEntriesByIndex,
		epochsViewActive,
		prevEpochBucket,
		bucketFadeT,
		recordOpacity,
		rowHeight,
		hoverGap,
		ctx,
		fontMain,
		fontMainHover,
		fontSmall,
		fontSmallHover,
		fontEpochLine1,
		fontEpochLine1Hover,
		colTextBase,
		colTextHover,
		colToday,
		colSummaryHoverBg,
		colRelated,
		colHighlight,
		activePath,
		relatedDateRange,
		semanticRelatedPaths,
		semanticRelatedTermPaths,
		semanticRelatedActiveTerm,
		inheritedMarkIndexByPath,
		epochsViewMarkedChildVisibleByDateKey,
		wrapFadeCache,
		packedEpochDayCenterY,
		epochPackAlphaByIndex,
		packedNormalDayCenterY,
		hoverAnimEffective,
		animSummaryEffective,
		prevAnimSummaryEffective,
		outgoingSummariesEffective,
		globalDenseMode,
		globalCompactMode,
		perDayDenseByIndex,
		denseBarHeightByIndex,
		rightWidthForText,
		xStart
	} = params;

	const layouts: DayLayout[] = [];
	const denseBarsToDraw: DenseBarVisual[] = [];
	let hoverOverlay: HoverOverlay | null = null;
	const filenameWordsCount = Number(s.plugin.settings.filenameWordsCount ?? 2);
	const summaryWordsCount = Number(s.plugin.settings.summaryWordsCount ?? 5);
	const showHiddenForRender = (() => {
		try {
			if (s.showHidden) return true;
			return /(^|\s)[!$]hidden(?=\s|$)/i.test(String(s.searchQuery || ""));
		} catch {
			return !!s.showHidden;
		}
	})();
	const hiddenOnlyForRender = (() => {
		try {
			return /(^|\s)[!$]hidden(?=\s|$)/i.test(String(s.searchQuery || ""));
		} catch {
			return false;
		}
	})();

	const markColorsRaw = getEpochMarkColorSet(s.root);
	const markColors = markColorsRaw;
	const compactModeMinWidthPercentRaw = Number(s.plugin.settings.compactModeMinWidthPercent ?? 30);
	const compactModeMinWidthPercent = Number.isFinite(compactModeMinWidthPercentRaw)
		? Math.max(0, Math.min(100, compactModeMinWidthPercentRaw))
		: 20;
	const compactMinWidthRatio = compactModeMinWidthPercent / 100;
	const pinRects = getPinBadgeRects(s as unknown as EpochCanvas);
	const nowMs = Date.now();
	const stableHideByDay = (() => {
		const existing = dateLabelHideStateByCanvas.get(s);
		if (existing) return existing;
		const created = new Map<number, DateLabelHideState>();
		dateLabelHideStateByCanvas.set(s, created);
		return created;
	})();

	for (const i of renderIndices) {
		const date = s.getDateForIndex(i, today);
		const worldY = i * BASE_SPACING;
		const yScreen = worldY * s.scale + s.offsetY;
		const packedCenterY = epochsViewActive ? packedEpochDayCenterY.get(i) : packedNormalDayCenterY.get(i);
		const dayCenterY = packedCenterY ?? yScreen;
		const epochDisableDropCaps = false;
		const dayHalfSpacing = (BASE_SPACING * s.scale) / 2;
		const dayTopBound = dayCenterY - dayHalfSpacing;
		const dayBottomBound = dayCenterY + dayHalfSpacing;

		const entries = entriesByIndex.get(i) ?? [];

		const tIn = s.animDateIndex === i ? s.hoverAnim : 0;
		let tOut = 0;
		const outgoingDates = s.outgoingDates;
		if (outgoingDates && outgoingDates.length) {
			for (let oi = 0; oi < outgoingDates.length; oi++) {
				const o = outgoingDates[oi];
				if (!o) continue;
				if (o.index === i) {
					const ot = Number(o.t);
					if (Number.isFinite(ot) && ot > tOut) tOut = ot;
				}
			}
		}
		const dateHoverT = Math.max(0, Math.min(1, Math.max(tIn, tOut)));
		const prevState = stableHideByDay.get(i);
		const wasHidden = prevState?.hidden === true;
		const hideTolerance = wasHidden ? 4 : 0;
		const hideCandidate = shouldHideDateLabelByPinOverlap(dayCenterY, pinRects, hideTolerance);
		const transitionCooldownMs = 120;
		const hideDateLabel = prevState
			&& hideCandidate !== prevState.hidden
			&& (nowMs - prevState.changedAt) < transitionCooldownMs
			? prevState.hidden
			: hideCandidate;
		if (!prevState || hideDateLabel !== prevState.hidden) {
			stableHideByDay.set(i, { hidden: hideDateLabel, changedAt: nowMs });
		} else {
			stableHideByDay.set(i, prevState);
		}

		const marker = drawDayMarker({
			ctx,
			dayIndex: i,
			yScreen,
			date,
			scale: s.scale,
			hoverT: dateHoverT,
			fontMain,
			fontMainHover,
			colTextBase,
			colSummaryHoverBg,
			colToday,
			hideLabel: hideDateLabel
		});

		const { kind, hasVisibleDate, dateRect } = marker;

		if (!hasVisibleDate && entries.length === 0 && s.scale < DAY_LABEL_MIN_SCALE) {
			continue;
		}

		const dayLayout: DayLayout = {
			index: i,
			y: yScreen,
			kind,
			dateRect,
			summaryRects: [],
			hasVisibleDate
		};

		if (epochsViewActive && prevEpochBucket && bucketFadeT < 1) {
			const prevEntries = prevEntriesByIndex.get(i) ?? [];
			if (prevEntries.length > 0) {
				const denseForPrev = false;
				ctx.save();
				ctx.globalAlpha *= (1 - bucketFadeT) * recordOpacity;
				renderDaySummaries({
					ctx,
					entries: prevEntries,

					dayIndex: i,
					dayCenterY,
					dayTopBound,
					dayBottomBound,
					viewportTop: 0,
					viewportBottom: h,
					canvasWidth: w,
					scale: s.scale,
					rowHeight,
					hoverAnim: 0,
					hoverGap,
					timelineX: TIMELINE_X,
					animSummary: null,
					outgoingSummaries: null,
					activeFilePath: activePath,
					relatedDateRange,
					semanticRelatedPaths,
					inheritedMarkIndexByPath,
					epochsViewMarkedChildVisibleByDateKey,
					showHidden: showHiddenForRender,
				hiddenOnly: hiddenOnlyForRender,
				filenameWordsCount,
				summaryWordsCount,
					iconCache: s.iconCache,
					fontSmall,
					fontSmallHover,
					colTextBase,
					colTextHover,
					colHighlight,
					colRelated,
					colTimelineBg: colSummaryHoverBg,
					markColors,
					getEntryTitle: (entry: DateEntry): string | null => s.getEntryTitle(entry),
					pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
					pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
					termSimilarPaths: semanticRelatedActiveTerm ? semanticRelatedTermPaths : null,
					compactMinWidthRatio,
					denseMode: denseForPrev,
					epochsView: epochsViewActive,
					epochDisableDropCaps,
					wrapFadeCache
				});
				ctx.restore();
			}
		}

		if (entries.length > 0) {
			const placeholdersWouldTouch = (() => {
				if (epochsViewActive) return false;
				if (!(s.scale < SUMMARY_MIN_SCALE)) return false;
				if (!(entries.length > 1)) return false;
				if (rowHeight <= SUMMARY_PLACEHOLDER_STROKE_WIDTH + 0.5) return true;

				const rightWidth = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
				if (!(rightWidth > SUMMARY_MIN_WIDTH)) return false;

				const dayHalfSpan = Math.max(rowHeight / 2, (BASE_SPACING * s.scale) / 2 - SUMMARY_MARGIN);
				const bandHeight = Math.max(rowHeight, dayHalfSpan * 2);
				const maxRows = Math.max(1, Math.floor(bandHeight / Math.max(0.000001, rowHeight)));
				const itemsPerCol = Math.max(1, Math.min(maxRows, entries.length));
				const colCount = Math.ceil(entries.length / itemsPerCol);
				if (colCount <= 1) return false;
				const rawColWidth = (rightWidth - (colCount - 1) * SUMMARY_COLUMN_GAP) / colCount;
				const colWidth = Math.min(SUMMARY_MAX_COL_WIDTH, rawColWidth);
				if (!(colWidth > 0.5)) return true;
				return colWidth <= SUMMARY_PLACEHOLDER_STROKE_WIDTH * 6;
			})();

			const denseForDay = (!epochsViewActive) && (s.scale <= SUMMARY_MIN_SCALE) && (globalDenseMode || (perDayDenseByIndex.get(i) === true) || placeholdersWouldTouch);
			const compactForDay = (!epochsViewActive) && (s.scale > SUMMARY_MIN_SCALE) && (
				globalCompactMode ||
				(rightWidthForText > SUMMARY_MIN_WIDTH && computeNeedsDenseByWidthFast({
					ctx,
					entries,
					xStart,
					rightWidth: rightWidthForText,
					compactMinWidthBaseWidth: w,
					scale: s.scale,
					rowHeight,
					fontSmall,
					activeFilePath: activePath,
					pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
					pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
					termSimilarPaths: semanticRelatedActiveTerm ? semanticRelatedTermPaths : null,
					compactMinWidthRatio
				}))
			);
			const dayOpacity = recordOpacity * (epochsViewActive && prevEpochBucket && bucketFadeT < 1 ? bucketFadeT : 1);

			if (!epochsViewActive && denseForDay) {
				const rightWidth = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
				if (rightWidth <= SUMMARY_MIN_WIDTH) {
					// nothing
				} else {
					if (s.scale > SUMMARY_MIN_SCALE) {
						const pc = estimateDenseBarPartitionCount({ scale: s.scale, rowHeight, entryCount: entries.length });
						const bucketEntries = pc > 0 ? entries.slice(0, Math.min(pc, entries.length)) : [];
						if (bucketEntries.length > 0) {
							const bucketCheck = buildNormalColumns({
								ctx,
								entries: bucketEntries,
								dayIndex: i,
								xStart: TIMELINE_X + SUMMARY_OFFSET_X,
								rightWidth,
								compactMinWidthBaseWidth: w,
								scale: s.scale,
								rowHeight,
								hoverAnim: s.hoverAnim,
								animSummary: s.animSummary,
								prevAnimSummary: s.prevAnimSummary ?? null,
								outgoingSummaries: s.outgoingSummaries ?? null,
								activeFilePath: activePath,
								relatedDateRange,
								semanticRelatedPaths,
								showHidden: showHiddenForRender,
								filenameWordsCount,
								summaryWordsCount,
								fontSmall,
								fontSmallHover,
								colTextBase,
								colTextHover,
								colHighlight,
								colRelated,
								markColors,
								inheritedMarkIndexByPath,
								pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
								pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
								termSimilarPaths: semanticRelatedActiveTerm ? semanticRelatedTermPaths : null,
								compactMinWidthRatio,
						getEntryTitle: (entry: DateEntry): string | null => s.getEntryTitle(entry)
							});
							if (bucketCheck.anyRenderableText && !bucketCheck.needsDenseByWidth) {
								ctx.save();
								ctx.globalAlpha *= dayOpacity;
								const summaryResult = renderDaySummaries({
									ctx,
									entries: bucketEntries,
										dayIndex: i,
									dayCenterY,
									dayTopBound,
									dayBottomBound,
									viewportTop: 0,
									viewportBottom: h,
									canvasWidth: w,
									scale: s.scale,
									compactMinWidthRatio,
									rowHeight,
									hoverAnim: hoverAnimEffective,
									hoverGap,
									timelineX: TIMELINE_X,
									animSummary: animSummaryEffective,
									prevAnimSummary: prevAnimSummaryEffective,
									outgoingSummaries: outgoingSummariesEffective,
									activeFilePath: activePath,
									relatedDateRange,
									semanticRelatedPaths,
									inheritedMarkIndexByPath,
									showHidden: showHiddenForRender,
									filenameWordsCount,
									summaryWordsCount,
									iconCache: s.iconCache,
									fontSmall,
									fontSmallHover,
									colTextBase,
									colTextHover,
									colHighlight,
									colRelated,
									colTimelineBg: colSummaryHoverBg,
									markColors,
							getEntryTitle: (entry: DateEntry): string | null => s.getEntryTitle(entry),
									pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
									pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
									termSimilarPaths: semanticRelatedActiveTerm ? semanticRelatedTermPaths : null,
									denseMode: false,
									epochsView: false,
									wrapFadeCache
								});
								dayLayout.summaryRects = summaryResult.summaryRects;
								dayLayout.summaryHoverRects = summaryResult.summaryHoverRects ?? summaryResult.summaryRects;
								ctx.restore();
								layouts.push(dayLayout);
								continue;
							}
						}
					}

					const daySpacing = BASE_SPACING * s.scale;
					const maxBarHeight = Math.max(1, daySpacing - 2);
					const partitionCount = s.scale > SUMMARY_MIN_SCALE
						? estimateDenseBarPartitionCount({ scale: s.scale, rowHeight, entryCount: entries.length })
						: 0;
					const visual = computeDenseBarVisual({
						entries,
						dayIndex: i,
						xStart: TIMELINE_X + SUMMARY_OFFSET_X,
						centerY: dayCenterY,
						availableWidth: rightWidth,
						desiredBarHeight: denseBarHeightByIndex.get(i),
						maxBarHeight,
						partitionCount: partitionCount > 1 ? partitionCount : undefined,
						partitionRowHeight: partitionCount > 1 ? rowHeight : undefined,
						partitionStrokeHeight: partitionCount > 1 ? SUMMARY_PLACEHOLDER_STROKE_WIDTH : undefined,
						colTextBase,
						colHighlight,
						colRelated,
						markColors,
						inheritedMarkIndexByPath,
						showHidden: showHiddenForRender,
						activeFilePath: activePath,
						semanticRelatedPaths
					});
					if (visual) {
						const rects = buildDenseSummaryRects(visual, entries);
						const hoverRects = buildDenseSummaryRects(visual, entries, HOVER_HIT_PAD, { allEntries: true });
						dayLayout.summaryRects = rects;
						dayLayout.summaryHoverRects = hoverRects;
						const highlightMatch = !!(s.animSummary && s.animSummary.dayIndex === i);
						const hoverT = highlightMatch ? Math.max(0, Math.min(1, Number(s.hoverAnim) || 0)) : 0;
						const hoverPartition = highlightMatch && s.animSummary ? s.animSummary.itemIndex : null;

						ctx.save();
						ctx.globalAlpha *= dayOpacity;
						drawDenseBarBase(ctx, visual);
						if (visual.hasActiveEntry) {
							const pc = Number(visual.partitionCount);
							const isPartitioned = Number.isFinite(pc) && pc > 1;
							const activePartition =
								isPartitioned && visual.activeItemIndex >= 0 && visual.activeItemIndex < Math.floor(pc)
									? visual.activeItemIndex
									: null;
							drawDenseBarHover(ctx, visual, 1, activePartition, colHighlight);
						}
						if (hoverT > 0.001) {
							drawDenseBarHover(ctx, visual, hoverT, hoverPartition, colHighlight);
						}
						ctx.restore();

						denseBarsToDraw.push(visual);
					}
				}
			} else {
				ctx.save();
				ctx.globalAlpha *= recordOpacity;
				if (epochsViewActive && epochPackAlphaByIndex) {
					const a = epochPackAlphaByIndex.get(i);
					const aa = typeof a === "number" && Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
					ctx.globalAlpha *= aa;
				}
				if (epochsViewActive && prevEpochBucket && bucketFadeT < 1) {
					ctx.globalAlpha *= bucketFadeT;
				}
				const summaryResult = renderDaySummaries({
					ctx,
					entries,
					dayIndex: i,
					dayCenterY,
					dayTopBound,
					dayBottomBound,
					viewportTop: 0,
					viewportBottom: h,
					canvasWidth: w,
					scale: s.scale,
					compactMinWidthRatio,
					rowHeight,
					hoverAnim: hoverAnimEffective,
					hoverGap,
					timelineX: TIMELINE_X,
					animSummary: animSummaryEffective,
					prevAnimSummary: prevAnimSummaryEffective,
					outgoingSummaries: outgoingSummariesEffective,
					activeFilePath: activePath,
					relatedDateRange,
					semanticRelatedPaths,
					inheritedMarkIndexByPath,
					epochsViewMarkedChildVisibleByDateKey,
					showHidden: showHiddenForRender,
					hiddenOnly: hiddenOnlyForRender,
					filenameWordsCount,
					summaryWordsCount,
					iconCache: s.iconCache,
					fontSmall,
					fontSmallHover,
					fontEpochLine1: epochsViewActive ? fontEpochLine1 : undefined,
					fontEpochLine1Hover: epochsViewActive ? fontEpochLine1Hover : undefined,
					colTextBase,
					colTextHover,
					colHighlight,
					colRelated,
					colTimelineBg: colSummaryHoverBg,
					markColors,
			getEntryTitle: (entry: DateEntry): string | null => s.getEntryTitle(entry),
					pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
					pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
					termSimilarPaths: semanticRelatedActiveTerm ? semanticRelatedTermPaths : null,
					denseMode: denseForDay || compactForDay,
					epochsView: epochsViewActive,
					epochDisableDropCaps,
					wrapFadeCache
				});
				ctx.restore();
				dayLayout.summaryRects = summaryResult.summaryRects;
				dayLayout.summaryHoverRects = summaryResult.summaryHoverRects ?? summaryResult.summaryRects;
				if (summaryResult.hoverOverlay) {
					hoverOverlay = summaryResult.hoverOverlay;
				}
			}
		}

		layouts.push(dayLayout);
	}

	return { layouts, hoverOverlay, denseBarsToDraw };
}
