import type { DateEntry } from "../../indexer/types";
import type { CanvasIconCache } from "../canvas-icon-cache";
import type { HoverOverlay, SummaryRect } from "../epoch-canvas-types";

export interface DaySummaryRenderArgs {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	dayIndex: number;
	dayCenterY: number;
	dayTopBound?: number;
	dayBottomBound?: number;
	viewportTop?: number;
	viewportBottom?: number;
	canvasWidth: number;
	scale: number;
	compactMinWidthRatio?: number;
	rowHeight: number;
	hoverAnim: number;
	hoverGap: number;
	timelineX: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	activeFilePath: string | null;
	relatedPaths?: Set<string> | null;
	filenameWordsCount: number;
	summaryWordsCount: number;
	iconCache: CanvasIconCache;
	fontSmall: string;
	fontSmallHover: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	colTimelineBg: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	wrapFadeCache?: Map<string, unknown> | null;
	getEntryTitle: (entry: DateEntry) => string | null;
	denseMode: boolean;
}

export interface DaySummaryRenderResult {
	summaryRects: SummaryRect[];
	summaryHoverRects?: SummaryRect[];
	hoverOverlay: HoverOverlay | null;
}
