import type { DateEntry } from "../../indexer/types";

import { getSummaryIconMetrics } from "../summary-rendering-icons";

export interface NormalMeasureArgs {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	dayIndex: number;
	xStart: number;
	rightWidth: number;
	compactMinWidthBaseWidth?: number;
	scale: number;
	compactMinWidthRatio?: number;
	compactMode?: boolean;
	rowHeight: number;
	hoverAnim: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	prevAnimSummary?: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	activeFilePath: string | null;
	relatedPaths?: Set<string> | null;
	filenameWordsCount: number;
	summaryWordsCount: number;
	fontSmall: string;
	fontSmallHover: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	getEntryTitle: (entry: DateEntry) => string | null;
	visibleRowIndexRange?: { start: number; end: number } | null;
	decorateTitle?: (args: { entryIndex: number; entry: DateEntry; title: string }) => string;
	decorateTextToWrap?: (args: {
		entryIndex: number;
		entry: DateEntry;
		title: string;
		effectiveSummary: string;
		textToWrap: string;
	}) => string;
	decoratePlusNBadgeColor?: (args: { entryIndex: number; entry: DateEntry; textToWrap: string; title: string }) => string | null;
	decoratePlusNBadgeBold?: (args: { entryIndex: number; entry: DateEntry; textToWrap: string; title: string }) => boolean | null;
}

export type RenderRow = {
	entryIndex: number;
	entry: DateEntry;
	height: number;
	lines: string[];
	lineHeight: number;
	maxLineWidth: number;
	textToWrap: string;
	maxTextWidth: number;
	summaryHoverT: number;
	isHoverTarget: boolean;
	isHoverIncoming: boolean;
	isActiveEntry: boolean;
	summaryFont: string;
	needsBoldFont: boolean;
	padY: number;
	baseColor: string;
	hoverSummaryColor: string;
	plusNBadgeColor?: string | null;
	plusNBadgeBold?: boolean | null;
	leadingIconIds: string[];
	hasTagIcon: boolean;
	leadingIconMetrics: ReturnType<typeof getSummaryIconMetrics>;
	tagIconMetrics: ReturnType<typeof getSummaryIconMetrics>;
	title: string;
	hoverFontStr?: string;
	hoverLineHeight?: number;
	hoverLines?: string[];
	hoverMaxLineWidth?: number;
	hoverTextRight?: number;
	hoverHeight?: number;
	hoverIconScale?: number;
	hoverTagExtraWidth?: number;
};

export type RenderColumn = {
	x: number;
	maxWidth: number;
	rowsThisCol: number;
	rows: RenderRow[];
	columnHeight: number;
	baseColumnHeight: number;
	forcedSingleLine?: boolean;
};
