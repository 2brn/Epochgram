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
    animSummary: { dayIndex: number; itemIndex: number } | null;
    animDateIndex: number | null;
    iconCache: CanvasIconCache;
    showHidden: boolean;
    showAttachments: boolean;
    showTrackedChanges: boolean;
    showContentDates: boolean;
    activeFilePath: string | null;
    pendingVisibilityDraw: boolean;
    visibilityRetryTimeout: number | null;
    suppressNextFocusHover: string | null;
    forceNextFocusHover: string | null;
    scheduleVisibilityCheck(): void;
    scaleFont(font: string, factor: number): string;
    getCssValue(css: CSSStyleDeclaration, property: string): string;
    getToday(): Date;
    getDateForIndex(index: number, today: Date): Date;
    getEntryTitle(entry: DateEntry): string;
    focusFile(filePath: string, line: number | null, useHoverHighlight: boolean): boolean;
    processPendingScrollNavHighlight(): void;
}

export function getDrawState(canvas: EpochCanvas): CanvasDrawState {
    return canvas as unknown as CanvasDrawState;
}
