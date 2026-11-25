import type { EpochCanvas } from "../epoch-canvas";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import { BASE_SPACING, HOVER_EXTRA_GAP, HOVER_ANIM_TIME_MS, SUMMARY_FONT_ZOOM_MAX, SUMMARY_FONT_ZOOM_RATE, SUMMARY_ROW_HEIGHT, VERTICAL_PADDING } from "../epoch-canvas-constants";
import type { CanvasDrawState } from "./state";
import { computeRenderIndicesAndEntries } from "./draw-days-entries";
import { computeDenseState } from "./draw-days-dense";
import { drawDayLayouts } from "./draw-days-render";
import { getTimelineViewportBounds } from "../epoch-canvas/viewport-limits";

export function drawVisibleDays(params: {
    canvas: EpochCanvas; s: CanvasDrawState; w: number; h: number; today: Date;
    fontMain: string; fontMainHover: string; fontSmall: string; fontSmallHover: string;
    colLine: string; colTextBase: string; colTextHover: string; colToday: string;
    colSummaryHoverBg: string; colRelated: string; colHighlight: string; recordOpacity?: number;
}): { layouts: DayLayout[]; hoverOverlay: HoverOverlay | null; totalVisibleEntries: number } {
    const { canvas, s, w, h, today } = params;
    if (!(s.wrapFadeCache instanceof Map)) s.wrapFadeCache = new Map();
    const wrapFadeCache = s.wrapFadeCache;
    const animationsEnabled = s.plugin?.settings?.enableAnimation !== false;
    const frameNow = window.performance.now();
    const ellipsisAnimMs = animationsEnabled ? Math.max(1, Math.min(260, Number(HOVER_ANIM_TIME_MS) || 160)) : 0;
    const lastNow = Number(s.__ellipsisNowLast);
    const dt = Number.isFinite(lastNow) && lastNow > 0 ? Math.max(0, frameNow - lastNow) : 0;
    s.__ellipsisNowLast = frameNow;
    const wasAnimating = s.__ellipsisPrevAnimatingView === true;
    const isInteracting = Number.isFinite(s.viewInteractionUntil) && frameNow < Number(s.viewInteractionUntil);
    const hasInertia = Number.isFinite(s.velocityY) && Math.abs(Number(s.velocityY)) > 0.01;
    const isAnimating = animationsEnabled && (s.animatingView === true || isInteracting || hasInertia);
    s.__ellipsisPrevAnimatingView = isAnimating;
    if (isAnimating || wasAnimating) s.__ellipsisSettleUntil = frameNow + ellipsisAnimMs;
    wrapFadeCache.set("__ellipsisAnimating", false);
    wrapFadeCache.set("__ellipsisNow", frameNow);
    wrapFadeCache.set("__ellipsisDt", dt);
    wrapFadeCache.set("__ellipsisAnimMs", ellipsisAnimMs);
    wrapFadeCache.set("__ellipsisSettleUntil", Number(s.__ellipsisSettleUntil));
    const opacity = Number(params.recordOpacity);
    const recordOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    const touchPinned = frameNow < Number(s.__touchHoverPinnedUntil ?? 0);
    const suppressHover = (isInteracting || hasInertia) && !s.keepHoverAfterMenu && !touchPinned;
    const hoverTarget = Number(s.hoverTarget) || 0;
    const hoverAnimEffective = suppressHover ? 0 : (animationsEnabled ? s.hoverAnim : (hoverTarget > 0.5 ? 1 : 0));
    const boost = s.scale > 1 ? Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE) : 1;
    const rowHeight = SUMMARY_ROW_HEIGHT * boost;
    const hoverGap = HOVER_EXTRA_GAP * boost;
    const bounds = getTimelineViewportBounds(today);
    const minIndex = Math.max(bounds.hardMinIndex, Math.floor((-VERTICAL_PADDING - s.offsetY) / (BASE_SPACING * s.scale)));
    const maxIndex = Math.min(bounds.hardMaxIndex, Math.ceil((h + VERTICAL_PADDING - s.offsetY) / (BASE_SPACING * s.scale)));
    const { renderIndices, entriesByIndex, totalVisibleEntries } = computeRenderIndicesAndEntries({ canvas, s, today, minIndex, maxIndex });
    const inheritedMarkIndexByPath = s.plugin?.__epochInheritedMarkIndexByPath ?? null;
    s.inheritedMarkSourceByPath = s.plugin?.__epochInheritedMarkSourceByPath ?? null;
    const ctx = s.ctx;
    ctx.textBaseline = "middle";
    const dense = computeDenseState({ ctx, entriesByIndex, renderIndices, w, scale: s.scale, rowHeight, fontSmall: params.fontSmall, activeFilePath: s.activeFilePath });
    s.__globalDenseMode = dense.globalDenseMode;
    s.__globalCompactMode = dense.globalCompactMode;
    const { layouts, hoverOverlay } = drawDayLayouts({
        ...params, renderIndices, entriesByIndex, recordOpacity, rowHeight, hoverGap, ctx,
        activePath: s.activeFilePath, relatedPaths: s.relatedPaths ?? null,
        inheritedMarkIndexByPath, wrapFadeCache, hoverAnimEffective,
        animSummaryEffective: suppressHover ? null : s.animSummary,
        prevAnimSummaryEffective: !animationsEnabled || suppressHover ? null : (s.prevAnimSummary ?? null),
        outgoingSummariesEffective: !animationsEnabled || suppressHover ? null : (s.outgoingSummaries ?? null),
        ...dense
    });
    if (wrapFadeCache.get("__ellipsisAnimating") === true) s.requestHoverAnimation?.();
    return { layouts, hoverOverlay, totalVisibleEntries };
}
