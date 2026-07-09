import type { DateEntry, DateSource } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import {
	focusDate as focusDateHelper,
	dateKeyToDate as dateKeyToDateHelper,
	getDayIndexForDate as getDayIndexForDateHelper,
	getSourcePriority
} from "../epoch-canvas-focus";
import { buildMiniSearchQueryParts, getEntriesForDate, pickEntryForFile } from "../entry-helpers";
import { BASE_SPACING, FOCUS_ANCHOR_RATIO } from "../epoch-canvas-constants";
import { parseTimelineQuery } from "../timeline-search";

type TimelineSearchIndexLike = {
	searchFileIdsRanked(args: ReturnType<typeof buildMiniSearchQueryParts>): unknown;
};

type ScrollNavFocusPluginLike = {
	timelineSearchIndex?: TimelineSearchIndexLike;
};

type ScrollNavFocusState = {
	root: HTMLElement;
	__pendingFocusFirstFilteredTimelineRecord?: boolean;
	pendingVisibilityDraw?: boolean;
	scheduleVisibilityCheck?: () => void;
	searchQuery?: string;
	plugin?: ScrollNavFocusPluginLike;
	index?: Record<string, DateEntry[]>;
	scrollNavFile?: string | null;
	scrollNavIndex: number;
	scrollNavAnchorEntry?: unknown;
	scrollNavAnchorDayIndex?: number | null;
	pendingScrollNavHighlight?: unknown;
	animatingView: boolean;
	scale: number;
	targetScale: number;
	offsetY: number;
	targetOffsetY: number;
	hoverSummary: { dayIndex?: number | null } | null;
	animSummary: { dayIndex?: number | null } | null;
	hoverTarget: number;
	draw?: () => void;
};

const DATE_SOURCES: ReadonlySet<DateSource> = new Set(["cdate", "namedate", "dateprop", "content", "tracked", "epoch"]);

function asScrollNavFocusState(canvas: EpochCanvas): ScrollNavFocusState {
	return canvas as unknown as ScrollNavFocusState;
}

function isDateSource(value: unknown): value is DateSource {
	return typeof value === "string" && DATE_SOURCES.has(value as DateSource);
}

function getEntrySource(entry: DateEntry | null): DateSource | null {
	if (!entry) return null;
	const source: unknown = entry.source;
	return isDateSource(source) ? source : null;
}

function getEntryPriority(entry: DateEntry | null): number {
	return getSourcePriority(getEntrySource(entry) ?? "content");
}

function getCanvasIndex(c: ScrollNavFocusState): Record<string, DateEntry[]> | null {
	const index = c.index;
	if (!index || typeof index !== "object") return null;
	return index;
}

function asFilePath(value: unknown): string {
	return typeof value === "string" ? value : "";
}

type DateSelectionCandidate = {
	date: Date;
	distance: number;
	ms: number;
	priority: number;
};

function dateDistanceFromToday(canvas: EpochCanvas, date: Date): number {
	const dayIndex = getDayIndexForDateHelper(canvas, date);
	if (!Number.isFinite(dayIndex)) return Number.POSITIVE_INFINITY;
	return Math.abs(Number(dayIndex));
}

function pickBetterDateCandidate(
	best: DateSelectionCandidate | null,
	next: DateSelectionCandidate
): DateSelectionCandidate {
	if (!best) return next;
	if (next.distance !== best.distance) return next.distance < best.distance ? next : best;
	if (next.priority !== best.priority) return next.priority < best.priority ? next : best;
	if (next.ms !== best.ms) return next.ms > best.ms ? next : best;
	return best;
}

function findBestDateForFile(
	canvas: EpochCanvas,
	index: Record<string, DateEntry[]>,
	filePath: string
): Date | null {
	let best: DateSelectionCandidate | null = null;
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const match = pickEntryForFile(canvas, entries, filePath, null);
		if (!match) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		const distance = dateDistanceFromToday(canvas, date);
		if (!Number.isFinite(distance)) continue;
		best = pickBetterDateCandidate(best, {
			date,
			distance,
			ms,
			priority: getEntryPriority(match)
		});
	}
	return best?.date ?? null;
}

function findBestVisibleDate(canvas: EpochCanvas, index: Record<string, DateEntry[]>): Date | null {
	let best: DateSelectionCandidate | null = null;
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		const distance = dateDistanceFromToday(canvas, date);
		if (!Number.isFinite(distance)) continue;
		best = pickBetterDateCandidate(best, {
			date,
			distance,
			ms,
			priority: 0
		});
	}
	return best?.date ?? null;
}

export function focusFirstFilteredTimelineRecord(canvas: EpochCanvas): boolean {
	const c = asScrollNavFocusState(canvas);
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			c.__pendingFocusFirstFilteredTimelineRecord = true;
			c.pendingVisibilityDraw = true;
			c.scheduleVisibilityCheck?.();
			return true;
		}
	} catch {
		// ignore
	}

	const rawQuery = String(c.searchQuery || "").trim();
	if (rawQuery) {
		try {
			const idx = c.plugin?.timelineSearchIndex;
			if (idx && typeof idx.searchFileIdsRanked === "function") {
				const parsed = parseTimelineQuery(rawQuery);
				const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
				if (hasAnySearch) {
					const ranked: unknown = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch });
					const rankedList = Array.isArray(ranked) ? ranked : [];
					for (const fpRaw of rankedList) {
						const filePath = asFilePath(fpRaw);
						if (!filePath) continue;

						const index = getCanvasIndex(c);
						if (!index) continue;

						const bestDate = findBestDateForFile(canvas, index, filePath);
						if (!bestDate) continue;
						try {
							c.scrollNavFile = filePath;
							c.scrollNavIndex = 0;
							c.scrollNavAnchorEntry = null;
							c.scrollNavAnchorDayIndex = getDayIndexForDateHelper(canvas, bestDate);
							c.pendingScrollNavHighlight = null;
						} catch {
							// ignore
						}
						c.animatingView = true;
						focusDateHelper(canvas, bestDate, true, true, true);
						return true;
					}
				}
			}
		} catch {
			// ignore
		}
	}

	const index = getCanvasIndex(c);
	if (!index) return false;
	const bestDate = findBestVisibleDate(canvas, index);
	if (!bestDate) return false;
	let dayIndex: number | null = null;
	try {
		const di0 = getDayIndexForDateHelper(canvas, bestDate);
		dayIndex = Number.isFinite(di0) ? Number(di0) : null;
	} catch {
		dayIndex = null;
	}
	try {
		c.scrollNavIndex = 0;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = dayIndex;
		c.pendingScrollNavHighlight = null;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, bestDate, true, true, true);
	return true;
}

export function snapFirstFilteredTimelineRecord(canvas: EpochCanvas, options: { draw?: boolean } = {}): boolean {
	const c = asScrollNavFocusState(canvas);
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			return false;
		}
	} catch {
		// ignore
	}
	const index = getCanvasIndex(c);
	if (!index) return false;

	const rawQuery = String(c.searchQuery || "").trim();
	let bestDate: Date | null = null;
	if (rawQuery) {
		try {
			const idx = c.plugin?.timelineSearchIndex;
			if (idx && typeof idx.searchFileIdsRanked === "function") {
				const parsed = parseTimelineQuery(rawQuery);
				const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
				if (hasAnySearch) {
					const ranked: unknown = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch });
					const rankedList = Array.isArray(ranked) ? ranked : [];
					for (const fpRaw of rankedList) {
						const filePath = asFilePath(fpRaw);
						if (!filePath) continue;
						bestDate = findBestDateForFile(canvas, index, filePath);
						if (bestDate) {
							c.scrollNavFile = filePath;
							break;
						}
					}
				}
			}
		} catch {
			// ignore
		}
	}

	if (!bestDate) {
		bestDate = findBestVisibleDate(canvas, index);
	}
	if (!bestDate) return false;

	const rect = c.root.getBoundingClientRect();
	if (!rect.height) return false;
	const dayIndex = getDayIndexForDateHelper(canvas, bestDate);
	const worldY = dayIndex * BASE_SPACING;
	const s = Number.isFinite(c.scale) && c.scale > 0 ? c.scale : 1;
	const anchorY = rect.height * FOCUS_ANCHOR_RATIO;
	const nextOffsetY = anchorY - worldY * s;
	try {
		c.scale = s;
		c.targetScale = s;
		c.offsetY = nextOffsetY;
		c.targetOffsetY = nextOffsetY;
		c.animatingView = false;
		c.pendingScrollNavHighlight = null;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = dayIndex;
		c.hoverSummary = null;
		c.animSummary = null;
		c.hoverTarget = 0;
	} catch {
		// ignore
	}
	if (options.draw !== false) {
		try {
			c.draw?.();
		} catch {
			// ignore
		}
	}
	return true;
}

export function focusFilteredTimelineRecordForFile(canvas: EpochCanvas, filePath: string): boolean {
	const c = asScrollNavFocusState(canvas);
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			return false;
		}
	} catch {
		// ignore
	}
	const index = getCanvasIndex(c);
	if (!index) return false;
	const fp = String(filePath || "");
	if (!fp) return false;

	const bestDate = findBestDateForFile(canvas, index, fp);
	if (!bestDate) return false;

	try {
		c.scrollNavFile = fp;
		c.scrollNavIndex = 0;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = getDayIndexForDateHelper(canvas, bestDate);
		c.pendingScrollNavHighlight = null;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, bestDate, true, true, true);
	return true;
}
