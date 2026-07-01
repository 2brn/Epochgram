import type { EpochCanvas } from "../epoch-canvas";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import {
    BASE_SPACING,
    HOVER_EXTRA_GAP,
    HOVER_ANIM_TIME_MS,
    SUMMARY_FONT_ZOOM_MAX,
    SUMMARY_FONT_ZOOM_RATE,
    SUMMARY_MIN_SCALE,
    SUMMARY_ROW_HEIGHT,
    VERTICAL_PADDING,
} from "../epoch-canvas-constants";
import type { EpochBucketName } from "../epoch-canvas-constants";
import { getEpochsViewMarkedChildVisibilityByDateKey } from "../entry-helpers";
import { getEpochMarkColorSet } from "../mark-colors";
import type { CanvasDrawState } from "./state";

import { computePackedEpochDayCenterY } from "./draw-days/packing";
import { computeRenderIndicesAndEntries } from "./draw-days-entries";
import { computeDenseState } from "./draw-days-dense";
import { drawDayLayouts } from "./draw-days-render";
import { getTimelineViewportBounds } from "../epoch-canvas/viewport-limits";

export function drawVisibleDays(params: {
    canvas: EpochCanvas;
    s: CanvasDrawState;
    w: number;
    h: number;
    today: Date;
    fontMain: string;
    fontMainHover: string;
    fontSmall: string;
    fontSmallHover: string;
    fontEpochLine1?: string;
    fontEpochLine1Hover?: string;
    colLine: string;
    colTextBase: string;
    colTextHover: string;
    colToday: string;
    colSummaryHoverBg: string;
    colRelated: string;
    colHighlight: string;
    epochsViewActive: boolean;
    epochBucket: EpochBucketName | null;
    prevEpochBucket: EpochBucketName | null;
    bucketFadeT: number;
    recordOpacity?: number;
}): {
    layouts: DayLayout[];
    hoverOverlay: HoverOverlay | null;
    totalVisibleEntries: number;
} {
    const {
        canvas,
        s,
        w,
        h,
        today,
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
        epochsViewActive,
        epochBucket,
        prevEpochBucket,
        bucketFadeT,
        recordOpacity: recordOpacityRaw
    } = params;

    if (!(s.wrapFadeCache instanceof Map)) {
        s.wrapFadeCache = new Map();
    }
    const wrapFadeCache: Map<string, unknown> = s.wrapFadeCache;
    s.packAnimating = false;

    const plugin = s.plugin;
    const animationsEnabled = plugin?.settings?.enableAnimation !== false;

    const frameNow = window.performance.now();
    const ellipsisAnimMs = animationsEnabled ? Math.max(1, Math.min(260, Number(HOVER_ANIM_TIME_MS) || 160)) : 0;
    const lastEllipsisNow = Number(s.__ellipsisNowLast);
    const ellipsisDt = (Number.isFinite(lastEllipsisNow) && lastEllipsisNow > 0)
        ? Math.max(0, frameNow - lastEllipsisNow)
        : 0;
    s.__ellipsisNowLast = frameNow;

    const wasViewAnimating = (s.__ellipsisPrevAnimatingView === true);
    const viewInteractionUntil = Number(s.viewInteractionUntil);
    const isViewInteracting = Number.isFinite(viewInteractionUntil) && frameNow < viewInteractionUntil;
    const velocityY = Number(s.velocityY);
    const hasInertia = Number.isFinite(velocityY) && Math.abs(velocityY) > 0.01;
    const isViewAnimating = animationsEnabled && ((s.animatingView === true) || isViewInteracting || hasInertia);
    s.__ellipsisPrevAnimatingView = isViewAnimating;
    if (isViewAnimating || (wasViewAnimating && !isViewAnimating)) {
        s.__ellipsisSettleUntil = frameNow + ellipsisAnimMs;
    }
    const settleUntil = Number(s.__ellipsisSettleUntil);

    wrapFadeCache.set("__ellipsisAnimating", false);
    wrapFadeCache.set("__ellipsisNow", frameNow);
    wrapFadeCache.set("__ellipsisDt", ellipsisDt);
    wrapFadeCache.set("__ellipsisAnimMs", ellipsisAnimMs);
    wrapFadeCache.set("__ellipsisSettleUntil", settleUntil);

    const recordOpacity = (() => {
        const n = Number(recordOpacityRaw);
        if (!Number.isFinite(n)) return 1;
        return Math.max(0, Math.min(1, n));
    })();

    // During active user pan/zoom (and inertia), avoid expensive hover/padding work.
    // However, touch long-press/menu flows rely on stable hover rendering; do not
    // suppress hover work while hover is explicitly pinned or while a menu is open.
    const keepHoverAfterMenu = (s.keepHoverAfterMenu === true);
    const touchPinnedUntil = Number(s.__touchHoverPinnedUntil ?? 0);
    const touchHoverPinned = Number.isFinite(touchPinnedUntil) && touchPinnedUntil > 0 && frameNow < touchPinnedUntil;
    const suppressHoverWork = (isViewInteracting || hasInertia) && !keepHoverAfterMenu && !touchHoverPinned;
	const hoverTargetRaw = Number(s.hoverTarget);
	const hoverTarget = Number.isFinite(hoverTargetRaw) ? Math.max(0, Math.min(1, hoverTargetRaw)) : 0;
    const hoverAnimEffective = suppressHoverWork
		? 0
		: (animationsEnabled ? s.hoverAnim : (hoverTarget > 0.5 ? 1 : 0));
    const animSummaryEffective = suppressHoverWork ? null : s.animSummary;
    const prevAnimSummaryEffective = (!animationsEnabled || suppressHoverWork) ? null : (s.prevAnimSummary ?? null);
    const outgoingSummariesEffective = (!animationsEnabled || suppressHoverWork) ? null : (s.outgoingSummaries ?? null);

    const rowHeight = (s.scale > 1
        ? SUMMARY_ROW_HEIGHT * Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE)
        : SUMMARY_ROW_HEIGHT);
    const hoverGap = (s.scale > 1
        ? HOVER_EXTRA_GAP * Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE)
        : HOVER_EXTRA_GAP);

    const minScreenY = -VERTICAL_PADDING;
    const maxScreenY = h + VERTICAL_PADDING;
    const requestedMinIndex = Math.floor((minScreenY - s.offsetY) / (BASE_SPACING * s.scale));
    const requestedMaxIndex = Math.ceil((maxScreenY - s.offsetY) / (BASE_SPACING * s.scale));
    const viewportBounds = getTimelineViewportBounds(today);
    const minIndex = Math.max(viewportBounds.hardMinIndex, requestedMinIndex);
    const maxIndex = Math.min(viewportBounds.hardMaxIndex, requestedMaxIndex);

	const { renderIndices, entriesByIndex, prevEntriesByIndex, totalVisibleEntries } = computeRenderIndicesAndEntries({
		canvas,
		s,
		today,
		minIndex,
		maxIndex,
		epochsViewActive,
		epochBucket,
		prevEpochBucket,
		bucketFadeT
	});

    const inheritedMarkIndexByPath: Map<string, number> | null = (() => {
        try {
            return plugin?.__epochInheritedMarkIndexByPath ?? null;
        } catch {
            return null;
        }
    })();
    const inheritedMarkSourceByPath: Map<string, string> | null = (() => {
        try {
            return plugin?.__epochInheritedMarkSourceByPath ?? null;
        } catch {
            return null;
        }
    })();
    try {
        s.inheritedMarkSourceByPath = inheritedMarkSourceByPath;
    } catch { void 0; }

    const ctx = s.ctx;
    ctx.textBaseline = "middle";

    const markColorsRaw = getEpochMarkColorSet(s.root);
    const markColors = markColorsRaw;
    const epochsViewMarkedChildVisibleByDateKey: Map<string, boolean> | null = epochsViewActive
        ? getEpochsViewMarkedChildVisibilityByDateKey(canvas)
        : null;
    const activePath = s.activeFilePath;
    const epochsEnabled = (() => {
        try {
            return plugin?.settings?.generateEpochs === true;
        } catch {
            return false;
        }
    })();
    const relatedDateRange = epochsEnabled ? (s.focusedEpochRange ?? null) : null;
    // If the feature is disabled, clear any lingering epoch range focus so the
    // timeline isn't stuck in an epoch-filtered state.
    if (!epochsEnabled) {
        try {
            s.focusedEpochRange = null;
        } catch {
            // ignore
        }
    }
    const semanticRelatedTermPaths: Set<string> | null = s.semanticRelatedTermPaths ?? null;
    const semanticRelatedActiveTerm: string | null = s.semanticRelatedActiveTerm ?? null;
    const semanticRelatedPathsRaw: Set<string> | null = s.semanticRelatedPaths ?? null;
    const semanticRelatedPaths: Set<string> | null = (() => {
        if (!semanticRelatedPathsRaw && !semanticRelatedTermPaths) return null;
        if (!semanticRelatedPathsRaw) return semanticRelatedTermPaths;
        if (!semanticRelatedTermPaths) return semanticRelatedPathsRaw;
        const out = new Set<string>();
        for (const p of semanticRelatedPathsRaw) out.add(p);
        for (const p of semanticRelatedTermPaths) out.add(p);
        return out;
    })();

    const {
		perDayDenseByIndex,
		denseBarHeightByIndex,
		rightWidthForText,
		xStart,
		globalDenseMode,
		globalCompactMode
	} = computeDenseState({
		ctx,
		entriesByIndex,
		renderIndices,
		w,
		epochsViewActive,
		scale: s.scale,
		rowHeight,
		fontSmall,
		activeFilePath: activePath,
        pathsWithEmbeddingTerm: s.pathsWithEmbeddingTerm ?? null,
        pathsWithClassifiedTerm: s.pathsWithClassifiedTerm ?? null,
		termSimilarPaths: null
	});

    s.__globalDenseMode = globalDenseMode;
    s.__globalCompactMode = globalCompactMode;

    let hoverOverlay: HoverOverlay | null = null;
    let layouts: DayLayout[] = [];

    const packedEpochDayCenterY = epochsViewActive
        ? computePackedEpochDayCenterY({
            canvas,
            s,
            w,
            frameNow,
            epochBucket,
            minIndex,
            maxIndex,
            renderIndices,
            entriesByIndex,
            prevEntriesByIndex,
            prevEpochBucket,
            bucketFadeT,
            rowHeight,
            hoverGap,
            ctx,
            activePath,
            fontSmall,
            fontSmallHover,
            fontEpochLine1,
            fontEpochLine1Hover,
            colTextBase,
            colTextHover,
            colHighlight,
            colRelated,
            markColors,
            inheritedMarkIndexByPath
        })
        : new Map<number, number>();

    const epochPackAlphaByIndex: Map<number, number> | null = epochsViewActive
        ? (s.epochPackAlphaByIndex ?? null)
        : null;

    const packedNormalDayCenterY = new Map<number, number>();

    const { layouts: computedLayouts, hoverOverlay: computedHoverOverlay, denseBarsToDraw } = drawDayLayouts({
		s,
		w,
		h,
		today,
		renderIndices,
		entriesByIndex,
		prevEntriesByIndex,
		epochsViewActive,
		prevEpochBucket: prevEpochBucket ? String(prevEpochBucket) : null,
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
	});

	layouts = computedLayouts;
	hoverOverlay = computedHoverOverlay;
	void denseBarsToDraw;

    const minScaleForHover = epochsViewActive ? 0 : SUMMARY_MIN_SCALE;
    if (hoverOverlay && s.scale >= minScaleForHover && s.hoverAnim > 0) {
        // leave to caller to draw overlay
    }

    if (wrapFadeCache.get("__ellipsisAnimating") === true) {
        s.requestHoverAnimation?.();
    }

    return { layouts, hoverOverlay, totalVisibleEntries };
}
