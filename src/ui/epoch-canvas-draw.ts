import type { EpochCanvas } from "./epoch-canvas";
import {
    TIMELINE_X,
    LINE_EXTRA,
    FOCUS_ANCHOR_RATIO,
    BASE_SPACING,
    SUMMARY_MIN_SCALE,
    SUMMARY_FONT_ZOOM_MAX,
    SUMMARY_FONT_ZOOM_RATE
} from "./epoch-canvas-constants";
import { drawHoverOverlay } from "./epoch-canvas-draw/draw-hover-overlay";
import { drawVisibleDays } from "./epoch-canvas-draw/draw-days";
import { resolveEpochBucketState } from "./epoch-canvas-draw/epoch-bucket";
import { getDrawState } from "./epoch-canvas-draw/state";
import { focusFirstFilteredTimelineRecord } from "./epoch-canvas/scroll-nav";
import {
    clampTimelineOffsetToBounds,
    getTimelineViewportBounds,
    resolveViewportHeight
} from "./epoch-canvas/viewport-limits";

type CanvasDrawStateInternals = ReturnType<typeof getDrawState> & {
    __lastKnownCanvasCssHeight?: number;
    win?: { devicePixelRatio?: number };
    hoverTarget?: number;
    entryDragGhost?: {
        img: HTMLCanvasElement;
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
    pinFly?: {
        img: HTMLCanvasElement;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        w: number;
        h: number;
        startAt: number;
        durationMs: number;
        t: number;
    } | null;
    pendingActiveFileFocus?: { path: string; line: number | null } | null;
    focusFile?: (path: string, line: number | null, useHoverHighlight: boolean) => boolean;
    __pendingFocusFirstFilteredTimelineRecord?: boolean;
};

function drawTodayDistanceIndicator(params: {
    canvas: EpochCanvas;
    s: ReturnType<typeof getDrawState>;
    h: number;
    colToday: string;
    today: Date;
}): void {
    const { s, h, colToday } = params;
    if (!Number.isFinite(h) || h <= 0) return;

    const scale = Number(s.scale);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const offsetY = Number(s.offsetY);
    if (!Number.isFinite(offsetY)) return;

    const anchorY = h * FOCUS_ANCHOR_RATIO;
    if (!Number.isFinite(anchorY)) return;

    const focusDayIndex = (anchorY - offsetY) / (BASE_SPACING * scale);
    if (!Number.isFinite(focusDayIndex)) return;

    // Hide when effectively at Today.
    if (Math.abs(focusDayIndex) < 0.25) return;

    // Scale: BASE_SPACING per month (scaled by zoom), clamped to available space.
    const DAYS_PER_MONTH = 365.25 / 12;
    const absMonths = Math.abs(focusDayIndex) / DAYS_PER_MONTH;
    const desiredLen = absMonths * (BASE_SPACING * scale);

    const ctx = s.ctx;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = colToday;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(TIMELINE_X - 3, anchorY);
    ctx.lineTo(TIMELINE_X + 3, anchorY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(TIMELINE_X, anchorY);

    if (focusDayIndex > 0) {
        // Past: extend down.
        const maxLen = Math.max(0, h - anchorY);
        const len = Math.min(maxLen, desiredLen);
        if (len >= 1) {
            ctx.lineTo(TIMELINE_X, anchorY + len);
            ctx.stroke();
        }
    } else {
        // Future: extend up.
        const maxLen = Math.max(0, anchorY);
        const len = Math.min(maxLen, desiredLen);
        if (len >= 1) {
            ctx.lineTo(TIMELINE_X, anchorY - len);
            ctx.stroke();
        }
    }

    ctx.restore();
}

function colorWithAlpha(color: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    const raw = String(color || "").trim();
    const hex = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (hex) {
		const value = hex[1];
		if (!value) return `rgba(0, 0, 0, ${a})`;
        const full = value.length === 3
            ? `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
            : value;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
		const parts = rgb[1].split(",").map((p) => Number(p.trim()));
        if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
            const r = Math.max(0, Math.min(255, Math.round(parts[0] ?? 0)));
            const g = Math.max(0, Math.min(255, Math.round(parts[1] ?? 0)));
            const b = Math.max(0, Math.min(255, Math.round(parts[2] ?? 0)));
            return `rgba(${r}, ${g}, ${b}, ${a})`;
        }
    }
    return `rgba(0, 0, 0, ${a})`;
}

function drawTimelineFadeMask(params: {
    s: ReturnType<typeof getDrawState>;
    ctx: CanvasRenderingContext2D;
    w: number;
    h: number;
    backgroundColor: string;
    today: Date;
}): void {
    const { s, ctx, w, h, backgroundColor, today } = params;
    if (!(w > 0 && h > 0)) return;

    const bounds = getTimelineViewportBounds(today);
    const pxPerDay = BASE_SPACING * s.scale;
    if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return;

    const yHardMin = bounds.hardMinIndex * pxPerDay + s.offsetY;
    const yCoreMin = bounds.coreMinIndex * pxPerDay + s.offsetY;
    const yCoreMax = bounds.coreMaxIndex * pxPerDay + s.offsetY;
    const yHardMax = bounds.hardMaxIndex * pxPerDay + s.offsetY;

    const opaque = colorWithAlpha(backgroundColor, 1);
    const transparent = colorWithAlpha(backgroundColor, 0);

    ctx.save();

    if (yHardMin > 0) {
        ctx.fillStyle = opaque;
        ctx.fillRect(0, 0, w, Math.min(h, yHardMin));
    }

    if (yCoreMin > yHardMin) {
        const g = ctx.createLinearGradient(0, yHardMin, 0, yCoreMin);
        g.addColorStop(0, opaque);
        g.addColorStop(1, transparent);
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.max(0, yHardMin), w, Math.min(h, yCoreMin) - Math.max(0, yHardMin));
    }

    if (yHardMax > yCoreMax) {
        const g = ctx.createLinearGradient(0, yCoreMax, 0, yHardMax);
        g.addColorStop(0, transparent);
        g.addColorStop(1, opaque);
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.max(0, yCoreMax), w, Math.min(h, yHardMax) - Math.max(0, yCoreMax));
    }

    if (yHardMax < h) {
        ctx.fillStyle = opaque;
        ctx.fillRect(0, Math.max(0, yHardMax), w, h - Math.max(0, yHardMax));
    }

    ctx.restore();
}

export function drawCanvas(canvas: EpochCanvas): void {
    const s = getDrawState(canvas) as CanvasDrawStateInternals;
    const ctx = s.ctx;
    const canvasElement = s.canvas;

    if (!canvasElement) {
        return;
    }

    const rect = s.root.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const viewportHeight = resolveViewportHeight(s.root, Number(s.__lastKnownCanvasCssHeight ?? 0));
    if (viewportHeight > 0) {
        const nowToday = s.getToday();
        s.offsetY = clampTimelineOffsetToBounds({
            offsetY: s.offsetY,
            scale: s.scale,
            viewportHeight,
            today: nowToday
        });
        s.targetOffsetY = clampTimelineOffsetToBounds({
            offsetY: s.targetOffsetY,
            scale: s.targetScale,
            viewportHeight,
            today: nowToday
        });
    }
    if (!w || !h) {
        s.pendingVisibilityDraw = true;
        s.scheduleVisibilityCheck();
        return;
    }
    s.pendingVisibilityDraw = false;
    if (s.visibilityRetryTimeout != null) {
        window.clearTimeout(s.visibilityRetryTimeout);
        s.visibilityRetryTimeout = null;
    }

    try {
        const win = s.win ?? window;
        const dpr = typeof win.devicePixelRatio === "number" ? win.devicePixelRatio : (window.devicePixelRatio || 1);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch {
        try {
            ctx.clearRect(0, 0, w, h);
        } catch {
            // ignore
        }
    }

    const css = window.getComputedStyle(s.root);
    const colLine = s.getCssValue(css, "--graph-line");
    const colTextBase = s.getCssValue(css, "--text-muted");
    const colTextHover = s.getCssValue(css, "--text-accent");
    const colToday = s.getCssValue(css, "--color-red");
    const fontMain = s.getCssValue(css, "--epoch-font-main");
    const fontMainHoverRaw = s.getCssValue(css, "--epoch-font-main-hover");
    const fontMainHover = fontMainHoverRaw;
    const zoomBoost = s.scale > 1
        ? Math.min(SUMMARY_FONT_ZOOM_MAX, 1 + (s.scale - 1) * SUMMARY_FONT_ZOOM_RATE)
        : 1;
    const effectiveBoost = zoomBoost;
    const bucketState = resolveEpochBucketState(canvas, Date.now(), h);
    const epochsViewActive = bucketState.epochsViewActive;

    const recordOpacity = 1;
    const fontSmallBase = s.getCssValue(css, epochsViewActive ? "--epoch-font-epochs-view" : "--epoch-font-small");
    const fontSmallHoverRaw = s.getCssValue(css, epochsViewActive ? "--epoch-font-epochs-view-hover" : "--epoch-font-small-hover");
    const fontSmall = s.scaleFont(fontSmallBase, effectiveBoost);
    const fontSmallHover = s.scaleFont(fontSmallHoverRaw, effectiveBoost);

    const fontEpochLine1Base = epochsViewActive
        ? s.getCssValue(css, "--epoch-font-epochs-view-line1")
        : fontSmallBase;
    const fontEpochLine1HoverRaw = epochsViewActive
        ? s.getCssValue(css, "--epoch-font-epochs-view-line1-hover")
        : fontSmallHoverRaw;
    const fontEpochLine1 = s.scaleFont(fontEpochLine1Base, effectiveBoost);
    const fontEpochLine1Hover = s.scaleFont(fontEpochLine1HoverRaw, effectiveBoost);
    const colSummaryHoverBg = (() => {
        const isTransparent = (bg: string): boolean => {
            const v = String(bg || "").trim();
            return !v || v === "transparent" || v === "rgba(0, 0, 0, 0)";
        };

        try {
            let el: HTMLElement | null = s.root;
            for (let i = 0; i < 8 && el; i++) {
                const st = window.getComputedStyle(el);
                const bg = String(st.backgroundColor ?? "").trim();
                if (!isTransparent(bg)) return bg;
                el = el.parentElement;
            }
        } catch {
            // ignore
        }

        const bg0 = String(css.backgroundColor ?? "").trim();
        if (!isTransparent(bg0)) return bg0;
        return s.getCssValue(css, "--background-primary");
    })();
    const colRelated = s.getCssValue(css, "--text-accent");
    const colHighlight = s.getCssValue(css, "--color-red");

    ctx.strokeStyle = colLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TIMELINE_X, -LINE_EXTRA);
    ctx.lineTo(TIMELINE_X, h + LINE_EXTRA);
    ctx.stroke();

    const today = s.getToday();

    drawTodayDistanceIndicator({
        canvas,
        s,
        h,
        colToday,
        today
    });

    const dayResult = drawVisibleDays({
        canvas,
        s,
        w,
        h,
        today,
        fontMain,
        fontMainHover,
        fontSmall,
        fontSmallHover,
        fontEpochLine1: epochsViewActive ? fontEpochLine1 : undefined,
        fontEpochLine1Hover: epochsViewActive ? fontEpochLine1Hover : undefined,
        colLine,
        colTextBase,
        colTextHover,
        colToday,
        colSummaryHoverBg,
        colRelated,
        colHighlight,
        epochsViewActive,
        epochBucket: bucketState.epochBucket,
        prevEpochBucket: bucketState.prevEpochBucket,
        bucketFadeT: bucketState.bucketFadeT,
        recordOpacity
    });

    s.layouts = dayResult.layouts;
    s.hoverOverlay = dayResult.hoverOverlay;

    if (s.hoverOverlay && (epochsViewActive || s.scale >= SUMMARY_MIN_SCALE) && s.hoverAnim > 0) {
        ctx.save();
        ctx.globalAlpha *= recordOpacity;
        drawHoverOverlay({
            ctx,
            hoverOverlay: s.hoverOverlay,
            hoverAnim: s.hoverAnim,
            hoverTarget: Number(s.hoverTarget ?? 0),
            colSummaryHoverBg,
            iconCache: s.iconCache,
            epochsViewActive
        });
        ctx.restore();
    }

    // Drag ghost: draw a semi-transparent snapshot that follows the pointer while dragging.
    try {
        const ghost = s.entryDragGhost;
        if (ghost && ghost.img && ghost.w > 0 && ghost.h > 0) {
            const x = Number(ghost.x);
            const y = Number(ghost.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                ctx.save();
                ctx.globalAlpha *= recordOpacity * 0.55;
                ctx.drawImage(ghost.img, x, y, ghost.w, ghost.h);
                ctx.restore();
            }
        }
    } catch {
        // ignore
    }

    // Pin animation: fly a semi-transparent copy of the pinned record to Today.
    try {
        const pinFly = s.pinFly;
        if (pinFly && pinFly.img && pinFly.w > 0 && pinFly.h > 0) {
            const t0 = Number(pinFly.t ?? 0);
            const t = Math.max(0, Math.min(1, Number.isFinite(t0) ? t0 : 0));
            const easeInCubic = (u: number) => u * u * u;
            const e = easeInCubic(t);
            const x = pinFly.fromX + (pinFly.toX - pinFly.fromX) * e;
            const y = pinFly.fromY + (pinFly.toY - pinFly.fromY) * e;
            const alpha = 1.0;
            if (alpha > 0.01) {
                ctx.save();
                ctx.globalAlpha *= recordOpacity * alpha;
                ctx.drawImage(pinFly.img, x, y, pinFly.w, pinFly.h);
                ctx.restore();
            }
        }
    } catch {
        // ignore
    }

    drawTimelineFadeMask({
        s,
        ctx,
        w,
        h,
        backgroundColor: colSummaryHoverBg,
        today
    });

    try {
        const pending = s.pendingActiveFileFocus;
        if (pending && w > 0 && h > 0) {
            // Clear first to avoid loops if focusing triggers another draw.
            s.pendingActiveFileFocus = null;
            const visible = canvas.hasVisibleEntryForFile(pending.path, pending.line);
            if (!visible) {
                // Scroll only; don't force hover highlight.
                s.focusFile?.(pending.path, pending.line, false);
            }
        }
    } catch {
        // ignore
    }
    s.processPendingScrollNavHighlight();

    const visibleEntryCount = dayResult.totalVisibleEntries;
    if (s.lastVisibleEntryCount !== visibleEntryCount) {
        s.lastVisibleEntryCount = visibleEntryCount;
    }

    try {
        const pending = s.__pendingFocusFirstFilteredTimelineRecord === true;
        if (pending) {
            s.__pendingFocusFirstFilteredTimelineRecord = false;
            focusFirstFilteredTimelineRecord(canvas);
        }
    } catch {
        // ignore
    }

}
