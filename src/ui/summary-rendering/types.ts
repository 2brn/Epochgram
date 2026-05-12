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
	rowHeight: number;
	hoverAnim: number;
	hoverGap: number;
	timelineX: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	activeFilePath: string | null;
	relatedDateRange?: { start: string; end: string } | null;
	semanticRelatedPaths?: Set<string> | null;
	showHidden: boolean;
	hiddenOnly?: boolean;
	filenameWordsCount: number;
	summaryWordsCount: number;
	iconCache: CanvasIconCache;
	fontSmall: string;
	fontSmallHover: string;
	fontEpochLine1?: string;
	fontEpochLine1Hover?: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	colTimelineBg: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	/** Epochs view only: visibility of *marked* (color-marked) child records under current filters. */
	epochsViewMarkedChildVisibleByDateKey?: Map<string, boolean> | null;
	pathsWithEmbeddingTerm?: Set<string> | null;
	pathsWithClassifiedTerm?: Set<string> | null;
	termSimilarPaths?: Set<string> | null;
	wrapFadeCache?: Map<string, any> | null;
	getEntryTitle: (entry: DateEntry) => string | null;
	denseMode: boolean;
	epochsView?: boolean;
	/** Epochs view only: disable drop-caps for packed/shifted blocks. */
	epochDisableDropCaps?: boolean;
}

export interface DaySummaryRenderResult {
	summaryRects: SummaryRect[];
	summaryHoverRects?: SummaryRect[];
	hoverOverlay: HoverOverlay | null;
}
