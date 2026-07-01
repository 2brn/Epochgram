import type { DateEntry } from "../indexer/types";

type DateKind = "day" | "month" | "year";

export type ScrollNavTarget =
	| { kind: "today" }
	| { kind: "entry"; date: Date; entry: DateEntry };

export interface SummaryRect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	itemIndex: number;
	entry: DateEntry;
	denseBarTotalCount?: number;
	compactTotalCount?: number;
	compactHiddenCount?: number;
	isPlaceholder?: boolean;
}

export interface DayLayout {
	index: number;
	y: number;
	kind: DateKind;
	dateRect: { x1: number; y1: number; x2: number; y2: number };
	summaryRects: SummaryRect[];
	summaryHoverRects?: SummaryRect[];
	hasVisibleDate: boolean;
}

export interface HoverOverlay {
	x: number;
	yTop: number;
	yBottom: number;
	yCenter: number;
	width: number;
	isEpoch?: boolean;
	// Epochs-view layout hints (optional; used to match non-hover drop-cap wrapping)
	yTextTop?: number;
	epochDropLineCount?: number;
	epochHasDropMixedLine?: boolean;
	epochDropMixedPrefix?: string;
	epochDropMixedRest?: string;
	tagIcon?: { x: number; centerY: number; size: number; gap: number; color: string; alpha: number };
	text: string;
	lines?: string[];
	yFirstLine?: number;
	lineHeight?: number;
	firstLineFont?: string;
	firstLineHeight?: number;
	font: string;
	color: string;
	alpha: number;
}
