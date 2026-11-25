import { BASE_SPACING, SUMMARY_MIN_SCALE, SUMMARY_MIN_WIDTH, SUMMARY_OFFSET_X, SUMMARY_RIGHT_MARGIN } from "./epoch-canvas-constants";
import { estimateDenseBarHeightForDenseMode } from "./summary-rendering/dense-height";
import { renderDenseDaySummary } from "./summary-rendering/dense";
import { renderNormalDaySummaries } from "./summary-rendering/normal";
import type { DaySummaryRenderArgs, DaySummaryRenderResult } from "./summary-rendering/types";
export type { DaySummaryRenderArgs, DaySummaryRenderResult } from "./summary-rendering/types";
export function renderDaySummaries(args: DaySummaryRenderArgs): DaySummaryRenderResult {
	const rightWidth = args.canvasWidth - (args.timelineX + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
	if (rightWidth <= SUMMARY_MIN_WIDTH) return { summaryRects: [], hoverOverlay: null };
	const xStart = args.timelineX + SUMMARY_OFFSET_X;
	if (args.denseMode && args.scale <= SUMMARY_MIN_SCALE) {
		return renderDenseDaySummary({ ...args, xStart, centerY: args.dayCenterY, availableWidth: rightWidth,
			desiredBarHeight: estimateDenseBarHeightForDenseMode({ scale: args.scale, rowHeight: args.rowHeight, entryCount: args.entries.length }),
			maxBarHeight: Math.max(1, BASE_SPACING * args.scale - 2) });
	}
	return renderNormalDaySummaries({ ...args, xStart, rightWidth, compactMinWidthBaseWidth: args.canvasWidth,
		compactMode: args.denseMode && args.scale > SUMMARY_MIN_SCALE,
		prevAnimSummary: args.prevAnimSummary ?? null, outgoingSummaries: args.outgoingSummaries ?? null,
		wrapFadeCache: args.wrapFadeCache ?? null });
}
