import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import { renderDaySummaries } from "../summary-rendering";
import { computeNeedsDenseByWidthFast } from "../summary-rendering/normal-measure";
import { buildDenseSummaryRects, computeDenseBarVisual, drawDenseBarBase, drawDenseBarHover, type DenseBarVisual } from "../summary-rendering/dense";
import { BASE_SPACING, DATE_RECT_HALF_HEIGHT, DATE_RECT_RIGHT_EXTRA, DAY_LABEL_MIN_SCALE, HOVER_HIT_PAD, LABEL_OFFSET_X, SUMMARY_COLUMN_GAP, SUMMARY_MARGIN, SUMMARY_MAX_COL_WIDTH, SUMMARY_MIN_SCALE, SUMMARY_MIN_WIDTH, SUMMARY_OFFSET_X, SUMMARY_PLACEHOLDER_STROKE_WIDTH, SUMMARY_RIGHT_MARGIN, TIMELINE_X } from "../epoch-canvas-constants";
import { getPinBadgeRects, type PinBadgeRect } from "../epoch-pin-overlay";
import { getEpochMarkColorSet } from "../mark-colors";
import { drawDayMarker } from "./draw-days/date-marker";
import type { CanvasDrawState } from "./state";
import type { DaySummaryRenderArgs } from "../summary-rendering/types";

type DateLabelHideState = { hidden: boolean; changedAt: number };
const dateLabelHideStateByCanvas = new WeakMap<CanvasDrawState, Map<number, DateLabelHideState>>();
function shouldHideDateLabelByPinOverlap(y: number, pins: PinBadgeRect[], tolerance: number): boolean {
    const rect = { x1: TIMELINE_X - (LABEL_OFFSET_X + 40) - tolerance, y1: y - DATE_RECT_HALF_HEIGHT - tolerance, x2: TIMELINE_X + DATE_RECT_RIGHT_EXTRA + tolerance, y2: y + DATE_RECT_HALF_HEIGHT + tolerance };
    return pins.some(pin => rect.x1 < pin.x2 && rect.x2 > pin.x1 && rect.y1 < pin.y2 && rect.y2 > pin.y1);
}
export function drawDayLayouts(params: {
    s: CanvasDrawState; w: number; h: number; today: Date; renderIndices: number[]; entriesByIndex: Map<number, DateEntry[]>;
    recordOpacity: number; rowHeight: number; hoverGap: number; ctx: CanvasRenderingContext2D;
    fontMain: string; fontMainHover: string; fontSmall: string; fontSmallHover: string;
    colTextBase: string; colTextHover: string; colToday: string; colSummaryHoverBg: string; colRelated: string; colHighlight: string;
    activePath: string | null; relatedPaths: Set<string> | null; inheritedMarkIndexByPath: Map<string, number> | null;
    wrapFadeCache: Map<string, unknown>; hoverAnimEffective: number;
    animSummaryEffective: DaySummaryRenderArgs["animSummary"]; prevAnimSummaryEffective: DaySummaryRenderArgs["prevAnimSummary"]; outgoingSummariesEffective: DaySummaryRenderArgs["outgoingSummaries"];
    globalDenseMode: boolean; globalCompactMode: boolean; perDayDenseByIndex: Map<number, boolean>; denseBarHeightByIndex: Map<number, number>; rightWidthForText: number; xStart: number;
}): { layouts: DayLayout[]; hoverOverlay: HoverOverlay | null; denseBarsToDraw: DenseBarVisual[] } {
    const { s, w, h, today, renderIndices, entriesByIndex, recordOpacity, rowHeight, hoverGap, ctx, fontMain, fontMainHover, fontSmall, fontSmallHover, colTextBase, colTextHover, colToday, colSummaryHoverBg, colRelated, colHighlight, activePath, relatedPaths, inheritedMarkIndexByPath, wrapFadeCache, hoverAnimEffective, animSummaryEffective, prevAnimSummaryEffective, outgoingSummariesEffective, globalDenseMode, globalCompactMode, perDayDenseByIndex, denseBarHeightByIndex, rightWidthForText, xStart } = params;
    const layouts: DayLayout[] = [];
    const denseBarsToDraw: DenseBarVisual[] = [];
    let hoverOverlay: HoverOverlay | null = null;
    const filenameWordsCount = Number(s.plugin.settings.filenameWordsCount ?? 2);
    const summaryWordsCount = Number(s.plugin.settings.summaryWordsCount ?? 5);
    const markColors = getEpochMarkColorSet(s.root);
    const compactPercent = Number(s.plugin.settings.compactModeMinWidthPercent ?? 30);
    const compactMinWidthRatio = (Number.isFinite(compactPercent) ? Math.max(0, Math.min(100, compactPercent)) : 20) / 100;
    const pinRects = getPinBadgeRects(s as unknown as EpochCanvas);
    const nowMs = Date.now();
    let stableHideByDay = dateLabelHideStateByCanvas.get(s);
    if (!stableHideByDay) { stableHideByDay = new Map(); dateLabelHideStateByCanvas.set(s, stableHideByDay); }
    for (const i of renderIndices) {
        const date = s.getDateForIndex(i, today);
        const yScreen = i * BASE_SPACING * s.scale + s.offsetY;
        const dayCenterY = yScreen;
        const dayHalfSpacing = BASE_SPACING * s.scale / 2;
        const dayTopBound = dayCenterY - dayHalfSpacing;
        const dayBottomBound = dayCenterY + dayHalfSpacing;
        const entries = entriesByIndex.get(i) ?? [];
        const tIn = s.animDateIndex === i ? s.hoverAnim : 0;
        let tOut = 0;
        for (const outgoing of s.outgoingDates ?? []) if (outgoing.index === i && Number.isFinite(outgoing.t)) tOut = Math.max(tOut, outgoing.t);
        const dateHoverT = Math.max(0, Math.min(1, Math.max(tIn, tOut)));
        const previous = stableHideByDay.get(i);
        const candidate = shouldHideDateLabelByPinOverlap(dayCenterY, pinRects, previous?.hidden ? 4 : 0);
        const hideDateLabel = previous && candidate !== previous.hidden && nowMs - previous.changedAt < 120 ? previous.hidden : candidate;
        if (!previous || hideDateLabel !== previous.hidden) stableHideByDay.set(i, { hidden: hideDateLabel, changedAt: nowMs });
        const { kind, hasVisibleDate, dateRect } = drawDayMarker({ ctx, dayIndex: i, yScreen, date, scale: s.scale, hoverT: dateHoverT, fontMain, fontMainHover, colTextBase, colSummaryHoverBg, colToday, hideLabel: hideDateLabel });
        if (!hasVisibleDate && !entries.length && s.scale < DAY_LABEL_MIN_SCALE) continue;
        const dayLayout: DayLayout = { index: i, y: yScreen, kind, dateRect, summaryRects: [], hasVisibleDate };
        if (entries.length) {
            const placeholdersWouldTouch = (() => {
                if (s.scale >= SUMMARY_MIN_SCALE || entries.length <= 1) return false;
                if (rowHeight <= SUMMARY_PLACEHOLDER_STROKE_WIDTH + 0.5) return true;
                const width = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
                if (width <= SUMMARY_MIN_WIDTH) return false;
                const halfSpan = Math.max(rowHeight / 2, BASE_SPACING * s.scale / 2 - SUMMARY_MARGIN);
                const maxRows = Math.max(1, Math.floor(Math.max(rowHeight, halfSpan * 2) / Math.max(0.000001, rowHeight)));
                const columns = Math.ceil(entries.length / Math.max(1, Math.min(maxRows, entries.length)));
                if (columns <= 1) return false;
                const colWidth = Math.min(SUMMARY_MAX_COL_WIDTH, (width - (columns - 1) * SUMMARY_COLUMN_GAP) / columns);
                return colWidth <= Math.max(0.5, SUMMARY_PLACEHOLDER_STROKE_WIDTH * 6);
            })();
            const denseForDay = s.scale <= SUMMARY_MIN_SCALE && (globalDenseMode || perDayDenseByIndex.get(i) === true || placeholdersWouldTouch);
            const compactForDay = s.scale > SUMMARY_MIN_SCALE && (globalCompactMode || (rightWidthForText > SUMMARY_MIN_WIDTH && computeNeedsDenseByWidthFast({ ctx, entries, xStart, rightWidth: rightWidthForText, compactMinWidthBaseWidth: w, scale: s.scale, rowHeight, fontSmall, activeFilePath: activePath, compactMinWidthRatio })));
            if (denseForDay) {
                const width = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
                if (width > SUMMARY_MIN_WIDTH) {
                    const visual = computeDenseBarVisual({ entries, dayIndex: i, xStart: TIMELINE_X + SUMMARY_OFFSET_X, centerY: dayCenterY, availableWidth: width, desiredBarHeight: denseBarHeightByIndex.get(i), maxBarHeight: Math.max(1, BASE_SPACING * s.scale - 2), colTextBase, colHighlight, colRelated, markColors, inheritedMarkIndexByPath, activeFilePath: activePath, relatedPaths });
                    if (visual) {
                        dayLayout.summaryRects = buildDenseSummaryRects(visual, entries);
                        dayLayout.summaryHoverRects = buildDenseSummaryRects(visual, entries, HOVER_HIT_PAD, { allEntries: true });
                        const highlightMatch = s.animSummary?.dayIndex === i;
                        const hoverT = highlightMatch ? Math.max(0, Math.min(1, Number(s.hoverAnim) || 0)) : 0;
                        const hoverPartition = highlightMatch && s.animSummary ? s.animSummary.itemIndex : null;
                        ctx.save(); ctx.globalAlpha *= recordOpacity;
                        drawDenseBarBase(ctx, visual);
                        if (visual.hasActiveEntry) {
                            const count = Number(visual.partitionCount);
                            const partition = Number.isFinite(count) && count > 1 && visual.activeItemIndex >= 0 && visual.activeItemIndex < Math.floor(count) ? visual.activeItemIndex : null;
                            drawDenseBarHover(ctx, visual, 1, partition, colHighlight);
                        }
                        if (hoverT > 0.001) drawDenseBarHover(ctx, visual, hoverT, hoverPartition, colHighlight);
                        ctx.restore(); denseBarsToDraw.push(visual);
                    }
                }
            } else {
                ctx.save(); ctx.globalAlpha *= recordOpacity;
                const result = renderDaySummaries({ ctx, entries, dayIndex: i, dayCenterY, dayTopBound, dayBottomBound, viewportTop: 0, viewportBottom: h, canvasWidth: w, scale: s.scale, compactMinWidthRatio, rowHeight, hoverAnim: hoverAnimEffective, hoverGap, timelineX: TIMELINE_X, animSummary: animSummaryEffective, prevAnimSummary: prevAnimSummaryEffective, outgoingSummaries: outgoingSummariesEffective, activeFilePath: activePath, relatedPaths, inheritedMarkIndexByPath, filenameWordsCount, summaryWordsCount, iconCache: s.iconCache, fontSmall, fontSmallHover, colTextBase, colTextHover, colHighlight, colRelated, colTimelineBg: colSummaryHoverBg, markColors, getEntryTitle: (entry: DateEntry) => s.getEntryTitle(entry), denseMode: compactForDay, wrapFadeCache });
                ctx.restore();
                dayLayout.summaryRects = result.summaryRects;
                dayLayout.summaryHoverRects = result.summaryHoverRects ?? result.summaryRects;
                if (result.hoverOverlay) hoverOverlay = result.hoverOverlay;
            }
        }
        layouts.push(dayLayout);
    }
    return { layouts, hoverOverlay, denseBarsToDraw };
}
