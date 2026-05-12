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

    const anyS: any = s as any;
    if (!(anyS.wrapFadeCache instanceof Map)) {
        anyS.wrapFadeCache = new Map();
    }
    const wrapFadeCache: Map<string, any> = anyS.wrapFadeCache;
    anyS.packAnimating = false;

    const pluginAny: any = (canvas as any)?.plugin;
    const animationsEnabled = pluginAny?.settings?.enableAnimation !== false;

    const frameNow = performance.now();
    const ellipsisAnimMs = animationsEnabled ? Math.max(1, Math.min(260, Number(HOVER_ANIM_TIME_MS) || 160)) : 0;
    const lastEllipsisNow = Number(anyS.__ellipsisNowLast);
    const ellipsisDt = (Number.isFinite(lastEllipsisNow) && lastEllipsisNow > 0)
        ? Math.max(0, frameNow - lastEllipsisNow)
        : 0;
    anyS.__ellipsisNowLast = frameNow;

    const wasViewAnimating = (anyS.__ellipsisPrevAnimatingView === true);
    const viewInteractionUntil = Number((s as any).viewInteractionUntil);
    const isViewInteracting = Number.isFinite(viewInteractionUntil) && frameNow < viewInteractionUntil;
    const velocityY = Number((s as any).velocityY);
    const hasInertia = Number.isFinite(velocityY) && Math.abs(velocityY) > 0.01;
    const isViewAnimating = animationsEnabled && (((s as any).animatingView === true) || isViewInteracting || hasInertia);
    anyS.__ellipsisPrevAnimatingView = isViewAnimating;
    if (isViewAnimating || (wasViewAnimating && !isViewAnimating)) {
        anyS.__ellipsisSettleUntil = frameNow + ellipsisAnimMs;
    }
    const settleUntil = Number(anyS.__ellipsisSettleUntil);

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
    const keepHoverAfterMenu = ((s as any).keepHoverAfterMenu === true);
    const touchPinnedUntil = Number((s as any).__touchHoverPinnedUntil ?? 0);
    const touchHoverPinned = Number.isFinite(touchPinnedUntil) && touchPinnedUntil > 0 && frameNow < touchPinnedUntil;
    const suppressHoverWork = (isViewInteracting || hasInertia) && !keepHoverAfterMenu && !touchHoverPinned;
	const hoverTargetRaw = Number((s as any).hoverTarget);
	const hoverTarget = Number.isFinite(hoverTargetRaw) ? Math.max(0, Math.min(1, hoverTargetRaw)) : 0;
    const hoverAnimEffective = suppressHoverWork
		? 0
		: (animationsEnabled ? s.hoverAnim : (hoverTarget > 0.5 ? 1 : 0));
    const animSummaryEffective = suppressHoverWork ? null : s.animSummary;
    const prevAnimSummaryEffective = (!animationsEnabled || suppressHoverWork) ? null : ((s as any).prevAnimSummary ?? null);
    const outgoingSummariesEffective = (!animationsEnabled || suppressHoverWork) ? null : ((s as any).outgoingSummaries ?? null);

    const rowHeight = (s.scale > 1
        ? SUMMARY_ROW_HEIGHT * Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE)
        : SUMMARY_ROW_HEIGHT);
    const hoverGap = (s.scale > 1
        ? HOVER_EXTRA_GAP * Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE)
        : HOVER_EXTRA_GAP);

    const minScreenY = -VERTICAL_PADDING;
    const maxScreenY = h + VERTICAL_PADDING;
    const minIndex = Math.floor((minScreenY - s.offsetY) / (BASE_SPACING * s.scale));
    const maxIndex = Math.ceil((maxScreenY - s.offsetY) / (BASE_SPACING * s.scale));

	const { renderIndices, entriesByIndex, prevEntriesByIndex, totalVisibleEntries } = computeRenderIndicesAndEntries({
		canvas,
		s,
		anyS,
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
            const pluginAny: any = (canvas as any)?.plugin;
            return (pluginAny?.__epochInheritedMarkIndexByPath as Map<string, number> | null | undefined) ?? null;
        } catch {
            return null;
        }
    })();
    const inheritedMarkSourceByPath: Map<string, string> | null = (() => {
        try {
            const pluginAny: any = (canvas as any)?.plugin;
            return (pluginAny?.__epochInheritedMarkSourceByPath as Map<string, string> | null | undefined) ?? null;
        } catch {
            return null;
        }
    })();
    try {
        (canvas as any).inheritedMarkSourceByPath = inheritedMarkSourceByPath;
    } catch {
    }

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
            const pluginAny: any = (canvas as any)?.plugin;
            return pluginAny?.settings?.generateEpochs === true;
        } catch {
            return false;
        }
    })();
    const relatedDateRange = epochsEnabled ? ((s as any).focusedEpochRange ?? null) : null;
    // If the feature is disabled, clear any lingering epoch range focus so the
    // timeline isn't stuck in an epoch-filtered state.
    if (!epochsEnabled) {
        try {
            (s as any).focusedEpochRange = null;
        } catch {
            // ignore
        }
    }
    const semanticRelatedTermPaths: Set<string> | null = (s as any).semanticRelatedTermPaths ?? null;
    const semanticRelatedActiveTerm: string | null = (s as any).semanticRelatedActiveTerm ?? null;
    const semanticRelatedPathsRaw: Set<string> | null = (s as any).semanticRelatedPaths ?? null;
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
		pathsWithEmbeddingTerm: (s as any)?.pathsWithEmbeddingTerm ?? null,
		pathsWithClassifiedTerm: (s as any)?.pathsWithClassifiedTerm ?? null,
		termSimilarPaths: null
	});

    anyS.__globalDenseMode = globalDenseMode;
    (anyS as any).__globalCompactMode = globalCompactMode;

    let hoverOverlay: HoverOverlay | null = null;
    let layouts: DayLayout[] = [];

    const packedEpochDayCenterY = epochsViewActive
        ? computePackedEpochDayCenterY({
            canvas,
            s,
            anyS,
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
        ? (((anyS as any).epochPackAlphaByIndex as Map<number, number> | null | undefined) ?? null)
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
        (canvas as any).requestHoverAnimation?.();
    }

    return { layouts, hoverOverlay, totalVisibleEntries };
}
