export function renderDaySummaries(args: DaySummaryRenderArgs): DaySummaryRenderResult {
	const summaryRects: DaySummaryRenderResult["summaryRects"] = [];
	const hoverOverlay: DaySummaryRenderResult["hoverOverlay"] = null;

	const rightWidth = args.canvasWidth - (args.timelineX + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
	if (rightWidth <= SUMMARY_MIN_WIDTH) {
		return { summaryRects, hoverOverlay };
	}

	const xStart = args.timelineX + SUMMARY_OFFSET_X;
	if (args.epochsView === true) {
		return renderEpochsDaySummaries({
			ctx: args.ctx,
			entries: args.entries,
			dayIndex: args.dayIndex,
			dayCenterY: args.dayCenterY,
			xStart,
			rightWidth,
			rowHeight: args.rowHeight,
			hoverAnim: args.hoverAnim,
			hoverGap: args.hoverGap,
			animSummary: args.animSummary,
			prevAnimSummary: args.prevAnimSummary ?? null,
			outgoingSummaries: args.outgoingSummaries ?? null,
			wrapFadeCache: args.wrapFadeCache ?? null,
			activeFilePath: args.activeFilePath,
			showHidden: args.showHidden,
			hiddenOnly: args.hiddenOnly,
			fontSmall: args.fontSmall,
			fontSmallHover: args.fontSmallHover,
			fontEpochLine1: args.fontEpochLine1,
			fontEpochLine1Hover: args.fontEpochLine1Hover,
			colTextBase: args.colTextBase,
			colTextHover: args.colTextHover,
			colHighlight: args.colHighlight,
			colRelated: args.colRelated,
			markColors: args.markColors,
			inheritedMarkIndexByPath: args.inheritedMarkIndexByPath,
			epochsViewMarkedChildVisibleByDateKey: args.epochsViewMarkedChildVisibleByDateKey ?? null,
			disableDropCaps: args.epochDisableDropCaps === true
		});
	}

	if (args.denseMode && args.scale <= SUMMARY_MIN_SCALE) {
		const desiredBarHeight = estimateDenseBarHeightForDenseMode({
			scale: args.scale,
			rowHeight: args.rowHeight,
			entryCount: args.entries.length
		});
		const maxBarHeight = Math.max(1, BASE_SPACING * args.scale - 2);
		return renderDenseDaySummary({
			ctx: args.ctx,
			entries: args.entries,
			dayIndex: args.dayIndex,
			xStart,
			centerY: args.dayCenterY,
			availableWidth: rightWidth,
			desiredBarHeight,
			maxBarHeight,
			partitionCount: undefined,
			partitionRowHeight: undefined,
			partitionStrokeHeight: undefined,
			colTextBase: args.colTextBase,
			colHighlight: args.colHighlight,
			colRelated: args.colRelated,
			markColors: args.markColors,
			inheritedMarkIndexByPath: args.inheritedMarkIndexByPath,
			showHidden: args.showHidden,
			activeFilePath: args.activeFilePath,
			semanticRelatedPaths: args.semanticRelatedPaths,
			animSummary: args.animSummary,
			hoverAnim: args.hoverAnim
		});
	}

	return renderNormalDaySummaries({
		ctx: args.ctx,
		entries: args.entries,
		dayIndex: args.dayIndex,
		dayCenterY: args.dayCenterY,
		dayTopBound: args.dayTopBound,
		dayBottomBound: args.dayBottomBound,
		viewportTop: args.viewportTop,
		viewportBottom: args.viewportBottom,
		xStart,
		rightWidth,
		scale: args.scale,
		compactMode: !!(args.denseMode && args.scale > SUMMARY_MIN_SCALE),
		rowHeight: args.rowHeight,
		hoverAnim: args.hoverAnim,
		animSummary: args.animSummary,
		prevAnimSummary: args.prevAnimSummary ?? null,
		outgoingSummaries: args.outgoingSummaries ?? null,
		activeFilePath: args.activeFilePath,
		relatedDateRange: args.relatedDateRange,
		semanticRelatedPaths: args.semanticRelatedPaths,
		showHidden: args.showHidden,
		filenameWordsCount: args.filenameWordsCount,
		summaryWordsCount: args.summaryWordsCount,
		iconCache: args.iconCache,
		fontSmall: args.fontSmall,
		fontSmallHover: args.fontSmallHover,
		colTextBase: args.colTextBase,
		colTextHover: args.colTextHover,
		colHighlight: args.colHighlight,
		colRelated: args.colRelated,
		markColors: args.markColors,
		inheritedMarkIndexByPath: args.inheritedMarkIndexByPath,
		pathsWithEmbeddingTerm: args.pathsWithEmbeddingTerm,
		pathsWithClassifiedTerm: args.pathsWithClassifiedTerm,
		termSimilarPaths: args.termSimilarPaths,
		wrapFadeCache: args.wrapFadeCache ?? null,
		getEntryTitle: args.getEntryTitle
	});
}

export type { DaySummaryRenderArgs, DaySummaryRenderResult } from "./summary-rendering/types";

import {
	BASE_SPACING,
	SUMMARY_MIN_SCALE,
	SUMMARY_MIN_WIDTH,
	SUMMARY_OFFSET_X,
	SUMMARY_RIGHT_MARGIN
} from "./epoch-canvas-constants";
import { estimateDenseBarHeightForDenseMode } from "./summary-rendering/dense-height";
import { renderDenseDaySummary } from "./summary-rendering/dense";
import { renderEpochsDaySummaries } from "./summary-rendering/epochs";
import { renderNormalDaySummaries } from "./summary-rendering/normal";
import type { DaySummaryRenderArgs, DaySummaryRenderResult } from "./summary-rendering/types";
