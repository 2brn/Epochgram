import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import type { CanvasIconCache } from "../canvas-icon-cache";

export interface CanvasDrawState {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    root: HTMLElement;
    scale: number;
    offsetY: number;
    targetScale: number;
    targetOffsetY: number;
    index: Record<string, DateEntry[]>;
    layouts: DayLayout[];
    lastVisibleEntryCount: number | null;
    hoverOverlay: HoverOverlay | null;
    hoverAnim: number;
    hoverTarget?: number;
    animSummary: { dayIndex: number; itemIndex: number } | null;
    prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
    outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
    outgoingDates?: Array<{ index: number; t: number }> | null;
    animDateIndex: number | null;
    animatingView?: boolean;
    velocityY?: number;
    viewInteractionUntil?: number;
    iconCache: CanvasIconCache;
    showAttachments: boolean;
    showDraftsOnly?: boolean;
    showContentDates: boolean;
    showPropDates?: boolean;
    activeFilePath: string | null;
    relatedPaths?: Set<string> | null;
    keepHoverAfterMenu?: boolean;
    __touchHoverPinnedUntil?: number;
    pendingVisibilityDraw: boolean;
    visibilityRetryTimeout: number | null;
    suppressNextFocusHover: string | null;
    forceNextFocusHover: string | null;
    searchQuery?: string;
    wrapFadeCache?: Map<string, unknown>;
    packAnimating?: boolean;
    __ellipsisNowLast?: number;
    __ellipsisPrevAnimatingView?: boolean;
    __ellipsisSettleUntil?: number;
    __globalDenseMode?: boolean;
    __globalCompactMode?: boolean;
    __entryIndexCacheRef?: Record<string, DateEntry[]>;
    __entryIndexCacheTodayKey?: string;
    __entryIndexCacheFilterKey?: string;
    __entryIndexCacheAll?: number[];
    inheritedMarkSourceByPath?: Map<string, string> | null;
    plugin: {
        settings: {
            enableAnimation?: boolean;
            filenameWordsCount?: number;
            summaryWordsCount?: number;
            compactModeMinWidthPercent?: number;
        };
        __epochInheritedMarkIndexByPath?: Map<string, number> | null;
        __epochInheritedMarkSourceByPath?: Map<string, string> | null;
    };
    scheduleVisibilityCheck(): void;
    scaleFont(font: string, factor: number): string;
    getCssValue(css: CSSStyleDeclaration, property: string): string;
    getToday(): Date;
    getDateForIndex(index: number, today: Date): Date;
    getEntryTitle(entry: DateEntry): string;
    focusFile(filePath: string, line: number | null, useHoverHighlight: boolean): boolean;
    processPendingScrollNavHighlight(): void;
    requestHoverAnimation(): void;
}

export function getDrawState(canvas: EpochCanvas): CanvasDrawState {
    return canvas as unknown as CanvasDrawState;
}
