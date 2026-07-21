import type { DateEntry } from "../../indexer/types";
import type { HoverOverlay, SummaryRect } from "../epoch-canvas-types";
import {
	SUMMARY_DENSE_BAR_MAX_HEIGHT,
	SUMMARY_DENSE_BAR_MIN_HEIGHT,
	SUMMARY_DENSE_HEIGHT_FALLBACK_REF_COUNT,
	SUMMARY_HIDDEN_ALPHA,
	HOVER_HIT_PAD,
	TOUCH_HIT_PAD
} from "../epoch-canvas-constants";
import { normalizeMarkColorIndex } from "../mark-colors";
import { getEntryMarkColor, getInheritedMarkColor } from "./entry-mark-colors";
import type { DaySummaryRenderResult } from "./types";

type DenseDayScanCache = {
	entryCount: number;
	firstFile: string;
	anyMarkedIndex: number;
	anyInheritedIndex: number;
	lastActiveFilePath: string | null;
	lastActiveIndex: number;
};

const denseDayScanCacheByDay = new Map<number, DenseDayScanCache>();

function getOrInitDenseDayScanCache(dayIndex: number, entries: DateEntry[]): DenseDayScanCache {
	const entryCount = entries.length;
	const firstFile = entryCount > 0 ? String(entries[0]?.file ?? "") : "";
	const prev = denseDayScanCacheByDay.get(dayIndex);
	if (prev && prev.entryCount === entryCount && prev.firstFile === firstFile) return prev;
	const next: DenseDayScanCache = {
		entryCount,
		firstFile,
		anyMarkedIndex: -1,
		anyInheritedIndex: -1,
		lastActiveFilePath: null,
		lastActiveIndex: -1
	};
	denseDayScanCacheByDay.set(dayIndex, next);
	if (denseDayScanCacheByDay.size > 5000) denseDayScanCacheByDay.clear();
	return next;
}

export type DenseBarVisual = {
	x: number;
	y: number;
	barWidth: number;
	barHeight: number;
	centerY: number;
	color: string;
	allHiddenVisible: boolean;
	hasActiveEntry: boolean;
	activeItemIndex: number;
	primaryEntry: DateEntry;
	primaryItemIndex: number;
	partitionCount?: number;
	partitionRowHeight?: number;
	partitionStrokeHeight?: number;
};

export type DenseBarComputeArgs = {
	entries: DateEntry[];
	dayIndex: number;
	xStart: number;
	centerY: number;
	availableWidth: number;
	desiredBarHeight?: number;
	maxBarHeight?: number;
	partitionCount?: number;
	partitionRowHeight?: number;
	partitionStrokeHeight?: number;
	colTextBase: string;
	colHighlight: string;
	colRelated: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	showHidden: boolean;
	activeFilePath: string | null;
	semanticRelatedPaths?: Set<string> | null;
};

export function computeDenseBarVisual(args: DenseBarComputeArgs): DenseBarVisual | null {
	const {
		entries,
		dayIndex,
		xStart,
		centerY,
		availableWidth,
		desiredBarHeight,
		maxBarHeight,
		partitionCount,
		partitionRowHeight,
		partitionStrokeHeight,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		showHidden,
		activeFilePath,
		semanticRelatedPaths
	} = args;

	if (!entries.length) return null;

	const cache = getOrInitDenseDayScanCache(dayIndex, entries);

	let activeEntry: DateEntry | null = null;
	let activeIndex: number = -1;
	let anyMarkedEntry: DateEntry | null = null;
	let anyInheritedColor: string | null = null;
	let hasSemantic = false;
	let hiddenVisibleCount = 0;

	if (activeFilePath) {
		if (cache.lastActiveFilePath === activeFilePath && cache.lastActiveIndex >= 0 && cache.lastActiveIndex < entries.length) {
			const e = entries[cache.lastActiveIndex];
			if (e.file === activeFilePath) {
				activeEntry = e;
				activeIndex = cache.lastActiveIndex;
			}
		}
		if (!activeEntry) {
			for (let idx = 0; idx < entries.length; idx++) {
				const entry = entries[idx];
				if (!entry) continue;
				if (entry.file === activeFilePath) {
					activeEntry = entry;
					activeIndex = idx;
					cache.lastActiveFilePath = activeFilePath;
					cache.lastActiveIndex = idx;
					break;
				}
			}
		}
	}

	if (cache.anyMarkedIndex >= 0) {
		anyMarkedEntry = entries[cache.anyMarkedIndex] ?? null;
	} else {
		for (let idx = 0; idx < entries.length; idx++) {
			const entry = entries[idx];
			if (!entry) continue;
			if (normalizeMarkColorIndex(entry.markColor) || String(entry.markColorHex ?? "").trim()) {
				cache.anyMarkedIndex = idx;
				anyMarkedEntry = entry;
				break;
			}
		}
	}

	if (cache.anyInheritedIndex >= 0) {
		const entry = entries[cache.anyInheritedIndex] ?? null;
		if (entry) {
			anyInheritedColor = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
			if (!anyInheritedColor) cache.anyInheritedIndex = -1;
		}
	}
	if (!anyInheritedColor && cache.anyInheritedIndex < 0) {
		for (let idx = 0; idx < entries.length; idx++) {
			const entry = entries[idx];
			if (!entry) continue;
			const inherited = getInheritedMarkColor(entry, markColors, colHighlight, inheritedMarkIndexByPath);
			if (inherited) {
				cache.anyInheritedIndex = idx;
				anyInheritedColor = inherited;
				break;
			}
		}
	}

	if (semanticRelatedPaths) {
		for (let idx = 0; idx < entries.length; idx++) {
			const entry = entries[idx];
			if (!entry) continue;
			if (semanticRelatedPaths.has(entry.file)) {
				hasSemantic = true;
				break;
			}
		}
	}

	if (showHidden) {
		for (let idx = 0; idx < entries.length; idx++) {
			if (String(entries[idx]?.reviewState ?? "") === "hidden") hiddenVisibleCount++;
		}
	}

	const hasActive = !!activeEntry;
	const allHiddenVisible = showHidden && hiddenVisibleCount === entries.length;
	const firstEntry = entries[0];
	if (!firstEntry) return null;
	let primaryEntry = activeEntry ?? firstEntry;
	let primaryItemIndex = activeEntry ? Math.max(0, activeIndex) : 0;
	if (!activeEntry) {
		const markedIndex = cache.anyMarkedIndex >= 0 && cache.anyMarkedIndex < entries.length ? cache.anyMarkedIndex : -1;
		const inheritedIndex = cache.anyInheritedIndex >= 0 && cache.anyInheritedIndex < entries.length ? cache.anyInheritedIndex : -1;
		const preferredIndex =
			markedIndex >= 0 && inheritedIndex >= 0
				? Math.min(markedIndex, inheritedIndex)
				: (markedIndex >= 0 ? markedIndex : inheritedIndex);
		if (preferredIndex >= 0) {
			primaryItemIndex = preferredIndex;
			const preferredEntry = entries[primaryItemIndex];
			if (preferredEntry) primaryEntry = preferredEntry;
		}
	}

	const activeMark = activeEntry ? getEntryMarkColor(activeEntry, markColors, colHighlight) : null;
	const activeInherited = activeEntry
		? getInheritedMarkColor(activeEntry, markColors, colHighlight, inheritedMarkIndexByPath)
		: null;
	const anyMark = anyMarkedEntry ? getEntryMarkColor(anyMarkedEntry, markColors, colHighlight) : null;
	const anyInherited = anyInheritedColor;
	let barHeight = (() => {
		const dh = Number(desiredBarHeight);
		if (Number.isFinite(dh) && dh > 0) return dh;
		const ratio = Math.min(1, entries.length / SUMMARY_DENSE_HEIGHT_FALLBACK_REF_COUNT);
		const heightRange = SUMMARY_DENSE_BAR_MAX_HEIGHT - SUMMARY_DENSE_BAR_MIN_HEIGHT;
		return Math.max(
			SUMMARY_DENSE_BAR_MIN_HEIGHT,
			SUMMARY_DENSE_BAR_MIN_HEIGHT + heightRange * ratio
		);
	})();
	barHeight = Math.max(SUMMARY_DENSE_BAR_MIN_HEIGHT, barHeight);
	if (Number.isFinite(maxBarHeight)) {
		barHeight = Math.max(1, Math.min(barHeight, Number(maxBarHeight)));
	}
	const barWidth = availableWidth;
	const x = xStart;
	const y = centerY - barHeight / 2;

	let color = colTextBase;
	if (activeMark) {
		color = activeMark;
	} else if (activeInherited) {
		color = activeInherited;
	} else if (anyMark) {
		color = anyMark;
	} else if (anyInherited) {
		color = anyInherited;
	} else if (hasActive || hasSemantic) {
		color = colRelated;
	}

	void dayIndex;
	return {
		x,
		y,
		barWidth,
		barHeight,
		centerY,
		color,
		allHiddenVisible,
		hasActiveEntry: hasActive,
		activeItemIndex: activeIndex,
		primaryEntry,
		primaryItemIndex,
		partitionCount,
		partitionRowHeight,
		partitionStrokeHeight
	};
}


export function buildDenseSummaryRects(
	visual: DenseBarVisual,
	entries: DateEntry[],
	hitPad: number = TOUCH_HIT_PAD,
	options: { allEntries?: boolean } = {}
): SummaryRect[] {
	const pad = Math.max(0, Number(hitPad) || 0);
	const x1 = visual.x - pad;
	const x2 = visual.x + visual.barWidth + pad;
	if (!entries.length) return [];

	const pc = Number(visual.partitionCount);
	const prh = Number(visual.partitionRowHeight);
	const psh = Number(visual.partitionStrokeHeight);
	const isPartitioned = Number.isFinite(pc) && pc > 1 && Number.isFinite(prh) && prh > 0 && Number.isFinite(psh) && psh > 0;
	if (isPartitioned) {
		const rows = Math.max(1, Math.floor(pc));
		const span = (rows - 1) * prh;
		const y0 = visual.centerY - span / 2;
		const out: SummaryRect[] = [];
		for (let r = 0; r < rows; r++) {
			if (r >= entries.length) break;
			const entry = entries[r];
			if (!entry) continue;
			const cy = y0 + r * prh;
			const y1 = cy - psh / 2 - pad;
			const y2 = cy + psh / 2 + pad;
			out.push({
				x1,
				y1,
				x2,
				y2,
				itemIndex: r,
				entry,
				// Metadata for click handling.
				denseBarTotalCount: entries.length
			});
		}
		return out;
	}

	const y1 = visual.y - pad;
	const y2 = visual.y + visual.barHeight + pad;
	const wantAll = options.allEntries === true;
	if (wantAll && entries.length > 1) {
		const primaryIndex = Number(visual.primaryItemIndex);
		const primary = Number.isFinite(primaryIndex) ? Math.max(0, Math.min(entries.length - 1, Math.floor(primaryIndex))) : 0;
		const order: number[] = [primary];
		for (let i = 0; i < entries.length; i++) {
			if (i === primary) continue;
			order.push(i);
		}
		const result: (SummaryRect & { denseBarTotalCount: number })[] = order.map((i) => ({
			x1,
			y1,
			x2,
			y2,
			itemIndex: i,
			entry: entries[i] ?? visual.primaryEntry,
			denseBarTotalCount: entries.length
		}));
		return result;
	}
	// Single dense bar maps to the primary record of the day.
	const single: (SummaryRect & { denseBarTotalCount: number })[] = [
		{
			x1,
			y1,
			x2,
			y2,
			itemIndex: visual.primaryItemIndex,
			entry: visual.primaryEntry,
			// Metadata for click handling.
			denseBarTotalCount: entries.length
		}
	];
	return single;
}

export function drawDenseBarBase(ctx: CanvasRenderingContext2D, visual: DenseBarVisual): void {
	ctx.save();
	ctx.fillStyle = visual.color;
	if (visual.allHiddenVisible) {
		ctx.globalAlpha *= SUMMARY_HIDDEN_ALPHA;
	}
	const pc = Number(visual.partitionCount);
	const prh = Number(visual.partitionRowHeight);
	const psh = Number(visual.partitionStrokeHeight);
	if (Number.isFinite(pc) && pc > 1 && Number.isFinite(prh) && prh > 0 && Number.isFinite(psh) && psh > 0) {
		// Draw multiple thin bars, aligned to row slots.
		const rows = Math.max(1, Math.floor(pc));
		const span = (rows - 1) * prh;
		const y0 = visual.centerY - span / 2;
		for (let r = 0; r < rows; r++) {
			const cy = y0 + r * prh;
			ctx.fillRect(visual.x, cy - psh / 2, visual.barWidth, psh);
		}
	} else {
		ctx.fillRect(visual.x, visual.y, visual.barWidth, visual.barHeight);
	}
	ctx.restore();
}

export function drawDenseBarHover(
	ctx: CanvasRenderingContext2D,
	visual: DenseBarVisual,
	hoverT: number,
	hoveredPartitionIndex: number | null = null,
	contourColor: string | null = null
): void {
	const t = Math.max(0, Math.min(1, Number(hoverT) || 0));
	if (t <= 0.001) return;

	// Dense hover should behave like zoomed-out placeholder hover:
	// - same color (no hue shift)
	// - increased opacity
	// - slightly thicker while hovering
	void contourColor;

	const alphaBoost = Math.min(1, 0.5 + 1.25 * t);
	const pc = Number(visual.partitionCount);
	const prh = Number(visual.partitionRowHeight);
	const psh = Number(visual.partitionStrokeHeight);
	const isPartitioned = Number.isFinite(pc) && pc > 1 && Number.isFinite(prh) && prh > 0 && Number.isFinite(psh) && psh > 0;

	ctx.save();
	if (visual.allHiddenVisible) {
		ctx.globalAlpha *= SUMMARY_HIDDEN_ALPHA;
	}
	ctx.globalAlpha *= alphaBoost;
	ctx.fillStyle = visual.color;
	if (isPartitioned) {
		const rows = Math.max(1, Math.floor(pc));
		const span = (rows - 1) * prh;
		const y0 = visual.centerY - span / 2;
		// Hover thickens each stroke slightly (similar to placeholder hover).
		const hoverStroke = Math.min(prh, Math.max(psh, psh + Math.min(3, Math.max(1.25, psh * 1.25)) * t));
		const hpi = hoveredPartitionIndex == null ? null : Math.floor(Number(hoveredPartitionIndex));
		for (let r = 0; r < rows; r++) {
			if (hpi != null && r !== hpi) continue;
			const cy = y0 + r * prh;
			ctx.fillRect(visual.x, cy - hoverStroke / 2, visual.barWidth, hoverStroke);
		}
	} else {
		const extraH = Math.min(4, Math.max(1.25, visual.barHeight * 0.25));
		const hoverHeight = visual.barHeight + extraH * t;
		const yHover = visual.centerY - hoverHeight / 2;
		ctx.fillRect(visual.x, yHover, visual.barWidth, hoverHeight);
	}
	ctx.restore();
}

interface DenseSummaryArgs {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	dayIndex: number;
	xStart: number;
	centerY: number;
	availableWidth: number;
	desiredBarHeight?: number;
	maxBarHeight?: number;
	partitionCount?: number;
	partitionRowHeight?: number;
	partitionStrokeHeight?: number;
	colTextBase: string;
	colHighlight: string;
	colRelated: string;
	markColors?: string[];
	inheritedMarkIndexByPath?: Map<string, number> | null;
	showHidden: boolean;
	activeFilePath: string | null;
	semanticRelatedPaths?: Set<string> | null;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	hoverAnim: number;
}

export function renderDenseDaySummary(args: DenseSummaryArgs): DaySummaryRenderResult {
	const {
		ctx,
		entries,
		dayIndex,
		xStart,
		centerY,
		availableWidth,
		desiredBarHeight,
		maxBarHeight,
		partitionCount,
		partitionRowHeight,
		partitionStrokeHeight,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		showHidden,
		activeFilePath,
		semanticRelatedPaths,
		animSummary,
		hoverAnim
	} = args;

	if (!entries.length) {
		return { summaryRects: [], hoverOverlay: null };
	}

	const visual = computeDenseBarVisual({
		entries,
		dayIndex,
		xStart,
		centerY,
		availableWidth,
		desiredBarHeight,
		maxBarHeight,
		partitionCount,
		partitionRowHeight,
		partitionStrokeHeight,
		colTextBase,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath,
		showHidden,
		activeFilePath,
		semanticRelatedPaths
	});
	if (!visual) {
		return { summaryRects: [], hoverOverlay: null };
	}

	const summaryRects = buildDenseSummaryRects(visual, entries);
	const summaryHoverRects = buildDenseSummaryRects(visual, entries, HOVER_HIT_PAD, { allEntries: true });
	const highlightMatch = animSummary && animSummary.dayIndex === dayIndex;
	const highlightT = highlightMatch ? Math.max(0, Math.min(1, hoverAnim)) : 0;
	const hoverPartition = highlightMatch && animSummary ? animSummary.itemIndex : null;

	drawDenseBarBase(ctx, visual);
	if (visual.hasActiveEntry) {
		const pc = Number(visual.partitionCount);
		const isPartitioned = Number.isFinite(pc) && pc > 1;
		const activePartition =
			isPartitioned && visual.activeItemIndex >= 0 && visual.activeItemIndex < Math.floor(pc)
				? visual.activeItemIndex
				: null;
		drawDenseBarHover(ctx, visual, 1, activePartition, colHighlight);
	}
	if (highlightT > 0.001) {
		drawDenseBarHover(ctx, visual, highlightT, hoverPartition, colHighlight);
	}

	const hoverOverlay: HoverOverlay | null = null;
	return { summaryRects, summaryHoverRects, hoverOverlay };
}
