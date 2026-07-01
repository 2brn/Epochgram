import { MS_PER_DAY, BASE_SPACING, FOCUS_ANCHOR_RATIO } from "./epoch-canvas-constants";
import type { DateEntry, EpochIndex } from "../indexer/types";
import type { DayLayout, SummaryRect } from "./epoch-canvas-types";
import { getEntriesForDate, pickEntryForFile } from "./entry-helpers";
import type { EpochCanvas } from "./epoch-canvas";

interface FocusCanvasInternals {
	scale: number;
	offsetY: number;
	getTodayOffset(): number;
	hoverDateIndex: number | null;
	hoverSummary: { dayIndex: number; itemIndex: number } | null;
	hoverTarget: number;
	hoverAnim: number;
	animDateIndex: number | null;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	draw(): void;
	root: HTMLElement;
	targetScale: number;
	targetOffsetY: number;
	animatingView: boolean;
	pendingVisibilityDraw: boolean;
	scheduleVisibilityCheck(): void;
	cancelFocusClear(): void;
	focusClearHandle: number | null;
	clearHover(force?: boolean): void;
	requestHoverAnimation(): void;
	index: EpochIndex;
	layouts: DayLayout[];
	getToday(): Date;
	getDateForIndex(index: number, today: Date): Date;
	clearSummaryHover(force?: boolean): void;
	keepHoverUntilPointerMove: boolean;
	__lastKnownCanvasCssHeight?: number;
	__shiftZoomLastDate?: { dayIndex: number; at: number } | null;
	__shiftZoomLastSummary?: { dayIndex: number; itemIndex: number; at: number } | null;
	outgoingDates?: Array<{ index: number; t: number }> | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	prevAnimDateIndex?: number | null;
	hoverEaseStartAt?: number | null;
	hoverEaseFrom?: number;
	hoverEaseTo?: number;
	scrollNavAnchorEntry?: DateEntry | null;
	scrollNavAnchorDayIndex?: number | null;
	isPointerDeviceEvent?: () => boolean;
}

function getFocusInternals(canvas: EpochCanvas): FocusCanvasInternals {
	return canvas as unknown as FocusCanvasInternals;
}

function isRecurringEntry(entry: DateEntry): boolean {
	return entry.recurring === true;
}

function scrollScreenRectIntoView(canvas: EpochCanvas, y1: number, y2: number, padding: number): boolean {
	const state = getFocusInternals(canvas);
	const rect = state.root.getBoundingClientRect();
	const cachedHeight0 = Number(state.__lastKnownCanvasCssHeight ?? 0);
	const height = rect.height || (Number.isFinite(cachedHeight0) ? cachedHeight0 : 0);
	if (!height) {
		state.pendingVisibilityDraw = true;
		state.scheduleVisibilityCheck();
		return false;
	}
	const topLimit = padding;
	const bottomLimit = height - padding;
	const top = Math.min(y1, y2);
	const bottom = Math.max(y1, y2);
	if (top >= topLimit && bottom <= bottomLimit) {
		return false;
	}
	const anchorY = state.getTodayOffset();
	const center = (top + bottom) / 2;
	const delta = anchorY - center;
	state.targetScale = state.scale;
	state.targetOffsetY = state.offsetY + delta;
	if (rect.height) {
		state.animatingView = true;
	} else {
		state.offsetY = state.targetOffsetY;
		state.animatingView = false;
	}
	state.requestHoverAnimation();
	return true;
}

export function focusToday(canvas: EpochCanvas): void {
	const state = getFocusInternals(canvas);
	// Animate to Today (instead of snapping), and let any active hover fade out
	// smoothly so epochs/date labels never reset without animation.
	state.targetScale = 1;
	state.targetOffsetY = state.getTodayOffset();
	state.animatingView = true;

	state.hoverDateIndex = null;
	state.hoverSummary = null;
	state.hoverTarget = 0;

	// If we're currently hovered (or mid-transition), keep anim* so the fade-out
	// can complete; runCanvasAnimation will clear anim* once hover reaches 0.
	if (!(Number.isFinite(state.hoverAnim) && Math.abs(state.hoverAnim) > 0.001)) {
		state.hoverAnim = 0;
		state.animDateIndex = null;
		state.animSummary = null;
	}

	state.requestHoverAnimation();
}

export function snapToToday(canvas: EpochCanvas, options: { draw?: boolean } = {}): void {
	const state = getFocusInternals(canvas);
	const anchorY = state.getTodayOffset();
	state.scale = 1;
	state.targetScale = 1;
	state.offsetY = anchorY;
	state.targetOffsetY = anchorY;
	state.animatingView = false;
	state.hoverDateIndex = null;
	state.hoverSummary = null;
	state.hoverTarget = 0;
	state.hoverAnim = 0;
	state.animDateIndex = null;
	state.animSummary = null;
	if (options.draw !== false) {
		state.draw();
	}
}

export function focusDate(
	canvas: EpochCanvas,
	date: Date,
	highlight: boolean,
	scroll: boolean,
	persistentHover: boolean = false
): boolean {
	const state = getFocusInternals(canvas);
	const diffDays = getDayIndexForDate(canvas, date);

	let didScroll = false;
	let didHighlight = false;

	if (scroll) {
		// If we're already animating the view (e.g. scroll-nav is in progress),
		// keep allowing retargeting even if the day is temporarily visible.
		if (!state.animatingView && isDateVisible(canvas, diffDays)) {
			scroll = false;
		}
		const rect = state.root.getBoundingClientRect();
		const cachedHeight0 = Number(state.__lastKnownCanvasCssHeight ?? 0);
		const height = rect.height || (Number.isFinite(cachedHeight0) ? cachedHeight0 : 0);
		if (height) {
			const worldY = diffDays * BASE_SPACING;
			const anchorY = height * FOCUS_ANCHOR_RATIO;
			state.targetScale = state.scale;
			state.targetOffsetY = anchorY - worldY * state.scale;
			if (rect.height) {
				state.animatingView = true;
			} else {
				state.offsetY = state.targetOffsetY;
				state.animatingView = false;
			}
			didScroll = true;
		} else {
			state.pendingVisibilityDraw = true;
			state.scheduleVisibilityCheck();
		}
	}

	if (highlight) {
		state.cancelFocusClear();
		// Programmatic navigation can optionally keep the hover until the user moves the pointer.
		// This avoids intermittent hover clearing on slow frames / large vaults.
		if (persistentHover) {
			state.keepHoverUntilPointerMove = true;
		}
		try {
			state.__shiftZoomLastDate = { dayIndex: diffDays, at: window.performance.now() };
			state.__shiftZoomLastSummary = null;
		} catch {
			// ignore
		}
		try {
			const prevIdx: number | null = state.animDateIndex ?? null;
			if (prevIdx != null && prevIdx !== diffDays) {
				let list = state.outgoingDates;
				if (!Array.isArray(list)) list = [];
				const t = Math.max(0, Math.min(1, Number(state.hoverAnim) || 0));
				if (t > 0.001) {
					list.push({ index: prevIdx, t });
					if (list.length > 8) {
						list.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0));
						list.length = 8;
					}
					state.outgoingDates = list;
				}
				state.prevAnimDateIndex = prevIdx;
			}
		} catch {
			// ignore
		}
		state.hoverSummary = null;
		state.hoverDateIndex = diffDays;
		state.animSummary = null;
		state.animDateIndex = diffDays;
		state.hoverTarget = 1;
		if (!persistentHover) {
			state.focusClearHandle = window.setTimeout(() => {
				state.focusClearHandle = null;
				state.clearHover();
			}, 750);
		}
		didHighlight = true;
	}

	if (scroll || highlight) {
		state.requestHoverAnimation();
	}

	return didScroll || didHighlight;
}

export function focusDateIfNeeded(canvas: EpochCanvas, date: Date, highlight: boolean): boolean {
	const dayIndex = getDayIndexForDate(canvas, date);
	const shouldScroll = !isDateVisible(canvas, dayIndex);
	return focusDate(canvas, date, highlight, shouldScroll);
}

export function focusFile(
	canvas: EpochCanvas,
	filePath: string,
	line: number | null,
	useHoverHighlight: boolean
): boolean {
	const state = getFocusInternals(canvas);
	let bestNonRecurring: { date: Date; ms: number } | null = null;
	let bestNonRecurringEntry: DateEntry | null = null;
	let bestOldestRecurring: { date: Date; ms: number } | null = null;
	let bestOldestRecurringEntry: DateEntry | null = null;
	for (const [dateKey, entries] of Object.entries(state.index)) {
		const nonRecurring = entries.filter((e) => !isRecurringEntry(e));
		const recurring = entries.filter((e) => isRecurringEntry(e));
		const matchNonRecurring = nonRecurring.length > 0
			? pickEntryForFile(canvas, nonRecurring, filePath, null, { bypassAttachmentsFilter: true, bypassDateFilters: true })
			: null;
		const matchRecurring = recurring.length > 0
			? pickEntryForFile(canvas, recurring, filePath, null, { bypassAttachmentsFilter: true, bypassDateFilters: true })
			: null;
		if (!matchNonRecurring && !matchRecurring) continue;
		const date = dateKeyToDate(dateKey);
		if (!date) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		if (matchNonRecurring) {
			if (!bestNonRecurring || ms > bestNonRecurring.ms) {
				bestNonRecurring = { date, ms };
				bestNonRecurringEntry = matchNonRecurring;
			}
		}
		if (matchRecurring) {
			if (!bestOldestRecurring || ms < bestOldestRecurring.ms) {
				bestOldestRecurring = { date, ms };
				bestOldestRecurringEntry = matchRecurring;
			}
		}
	}
	const best = (() => {
		if (!bestNonRecurring) return bestOldestRecurring;
		if (!bestOldestRecurring) return bestNonRecurring;
		return bestNonRecurring.ms >= bestOldestRecurring.ms ? bestNonRecurring : bestOldestRecurring;
	})();
	const bestEntry = (() => {
		if (!bestNonRecurring) return bestOldestRecurringEntry;
		if (!bestOldestRecurring) return bestNonRecurringEntry;
		return bestNonRecurring.ms >= bestOldestRecurring.ms ? bestNonRecurringEntry : bestOldestRecurringEntry;
	})();
	if (!best || !bestEntry) return false;
	const dayIndex = getDayIndexForDate(canvas, best.date);
	const shouldScroll = !isDateVisible(canvas, dayIndex);
	const scrolled = focusDate(canvas, best.date, useHoverHighlight, shouldScroll);
	const layout = findLayoutForDate(canvas, best.date);
	let highlighted = false;
	if (layout) {
		highlighted = focusSummaryForEntry(canvas, layout, bestEntry, useHoverHighlight);
	} else {
		if (!scrolled) {
			state.pendingVisibilityDraw = true;
			state.scheduleVisibilityCheck();
		}
		if (useHoverHighlight) {
			state.clearSummaryHover();
		}
	}
	if (useHoverHighlight && !highlighted) {
		state.clearSummaryHover();
	}
	try {
		state.scrollNavAnchorEntry = bestEntry;
		state.scrollNavAnchorDayIndex = dayIndex;
	} catch {
		// ignore
	}
	return scrolled || highlighted;
}

export function snapToFile(
	canvas: EpochCanvas,
	filePath: string,
	line: number | null = null,
	options: { draw?: boolean } = {}
): boolean {
	const state = getFocusInternals(canvas);
	const rect = state.root.getBoundingClientRect();
	if (!rect.height) {
		state.pendingVisibilityDraw = true;
		state.scheduleVisibilityCheck();
		return false;
	}

	let bestNonRecurring: { date: Date; ms: number } | null = null;
	let bestNonRecurringEntry: DateEntry | null = null;
	let bestOldestRecurring: { date: Date; ms: number } | null = null;
	let bestOldestRecurringEntry: DateEntry | null = null;
	for (const [dateKey, entries] of Object.entries(state.index)) {
		const nonRecurring = entries.filter((e) => !isRecurringEntry(e));
		const recurring = entries.filter((e) => isRecurringEntry(e));
		const matchNonRecurring = nonRecurring.length > 0
			? pickEntryForFile(canvas, nonRecurring, filePath, null)
			: null;
		const matchRecurring = recurring.length > 0
			? pickEntryForFile(canvas, recurring, filePath, null)
			: null;
		if (!matchNonRecurring && !matchRecurring) continue;
		const date = dateKeyToDate(dateKey);
		if (!date) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		if (matchNonRecurring) {
			if (!bestNonRecurring || ms > bestNonRecurring.ms) {
				bestNonRecurring = { date, ms };
				bestNonRecurringEntry = matchNonRecurring;
			}
		}
		if (matchRecurring) {
			if (!bestOldestRecurring || ms < bestOldestRecurring.ms) {
				bestOldestRecurring = { date, ms };
				bestOldestRecurringEntry = matchRecurring;
			}
		}
	}
	const best = (() => {
		if (!bestNonRecurring) return bestOldestRecurring;
		if (!bestOldestRecurring) return bestNonRecurring;
		return bestNonRecurring.ms >= bestOldestRecurring.ms ? bestNonRecurring : bestOldestRecurring;
	})();
	const bestEntry = (() => {
		if (!bestNonRecurring) return bestOldestRecurringEntry;
		if (!bestOldestRecurring) return bestNonRecurringEntry;
		return bestNonRecurring.ms >= bestOldestRecurring.ms ? bestNonRecurringEntry : bestOldestRecurringEntry;
	})();
	void bestEntry;
	if (!best) return false;

	const dayIndex = getDayIndexForDate(canvas, best.date);
	const worldY = dayIndex * BASE_SPACING;
	const s = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1;
	const anchorY = rect.height * FOCUS_ANCHOR_RATIO;
	const nextOffsetY = anchorY - worldY * s;
	state.scale = s;
	state.targetScale = s;
	state.offsetY = nextOffsetY;
	state.targetOffsetY = nextOffsetY;
	state.animatingView = false;
	if (options.draw !== false) {
		state.draw();
	}
	try {
		state.scrollNavAnchorEntry = bestEntry;
		state.scrollNavAnchorDayIndex = dayIndex;
	} catch {
		// ignore
	}
	return true;
}

export function focusSummaryForLine(
	canvas: EpochCanvas,
	filePath: string,
	line: number,
	useHoverHighlight: boolean
): boolean {
	const state = getFocusInternals(canvas);
	const today = state.getToday();
	for (const layout of state.layouts) {
		if (!layout.summaryRects || layout.summaryRects.length === 0) continue;
		const summary = layout.summaryRects.find((rect) => {
			const entry = rect.entry;
			if (entry.file !== filePath) return false;
			const start = entry.blockStart ?? 0;
			const end = entry.blockEnd ?? start;
			return line >= start && line <= end;
		});
		if (summary) {
			const date = state.getDateForIndex(layout.index, today);
			focusDate(canvas, date, useHoverHighlight, false);
			scrollScreenRectIntoView(canvas, summary.y1, summary.y2, 100);
			if (useHoverHighlight) {
				setHoverSummary(canvas, layout.index, summary.itemIndex);
			} else {
				const hasPointer = (() => {
					try {
						const fn = state.isPointerDeviceEvent;
						return typeof fn === "function" ? !!fn.call(state) : true;
					} catch {
						return true;
					}
				})();
				if (hasPointer) {
					state.clearHover();
				}
			}
			return true;
		}
	}
	return false;
}

export function focusSummaryForEntry(
	canvas: EpochCanvas,
	layout: DayLayout,
	entry: DateEntry,
	useHoverHighlight: boolean,
	persistentHover: boolean = false
): boolean {
	const state = getFocusInternals(canvas);
	const hoverRects = layout.summaryHoverRects;
	const allRects = ((): SummaryRect[] => {
		const out: SummaryRect[] = [];
		if (Array.isArray(layout.summaryRects) && layout.summaryRects.length > 0) out.push(...layout.summaryRects);
		if (Array.isArray(hoverRects) && hoverRects.length > 0 && hoverRects !== layout.summaryRects) out.push(...hoverRects);
		return out;
	})();
	if (!allRects || allRects.length === 0) return false;
	let summary: SummaryRect | undefined = allRects.find((rect) => rect.entry === entry);
	if (!summary) {
		const file = String(entry.file ?? "");
		const source = String(entry.source ?? "");
		const bs = Number(entry.blockStart ?? -1);
		const be = Number(entry.blockEnd ?? -1);
		summary = allRects.find((rect) => {
			const e = rect.entry;
			if (!e) return false;
			if (String(e.file ?? "") !== file) return false;
			if (String(e.source ?? "") !== source) return false;
			const ebs = Number(e.blockStart ?? -1);
			const ebe = Number(e.blockEnd ?? -1);
			return ebs === bs && ebe === be;
		});
	}
	if (!summary) {
		try {
			const today = state.getToday();
			const date = state.getDateForIndex(layout.index, today);
			const entries = getEntriesForDate(canvas, date);
			const baseRects: SummaryRect[] =
				Array.isArray(layout.summaryRects) && layout.summaryRects.length > 0
					? layout.summaryRects
					: Array.isArray(hoverRects) && hoverRects.length > 0
						? hoverRects
						: [];
			let visibleCount = 0;
			for (const r of baseRects) {
				const idx = Number(r.itemIndex);
				if (!Number.isFinite(idx)) continue;
				visibleCount = Math.max(visibleCount, Math.floor(idx) + 1);
			}
			if (visibleCount > 0 && entries.length > visibleCount) {
				const file = String(entry.file ?? "");
				const source = String(entry.source ?? "");
				const bs = Number(entry.blockStart ?? -1);
				const be = Number(entry.blockEnd ?? -1);
				const entryIndex = entries.findIndex((e) => {
					if (!e) return false;
					if (String(e.file ?? "") !== file) return false;
					if (String(e.source ?? "") !== source) return false;
					const ebs = Number(e.blockStart ?? -1);
					const ebe = Number(e.blockEnd ?? -1);
					return ebs === bs && ebe === be;
				});
				if (entryIndex >= visibleCount) {
					const lastVisibleItemIndex = visibleCount - 1;
					summary = allRects.find((rect) => Number(rect.itemIndex) === lastVisibleItemIndex);
				}
			}
		} catch {
			// ignore
		}
	}
	if (!summary) return false;
	scrollScreenRectIntoView(canvas, summary.y1, summary.y2, 100);
	if (useHoverHighlight) {
		setHoverSummary(canvas, layout.index, summary.itemIndex, persistentHover);
	} else {
		const hasPointer = (() => {
			try {
				const fn = state.isPointerDeviceEvent;
				return typeof fn === "function" ? !!fn.call(state) : true;
			} catch {
				return true;
			}
		})();
		if (hasPointer) {
			state.clearHover();
		}
	}
	return true;
}

export function setHoverSummary(
	canvas: EpochCanvas,
	dayIndex: number,
	itemIndex: number,
	persistent = false
): void {
	const state = getFocusInternals(canvas);
	state.cancelFocusClear();
	const prevAnimSummary = state.animSummary;
	const prevAnimDateIndex = state.animDateIndex;
	try {
		state.__shiftZoomLastSummary = { dayIndex, itemIndex, at: window.performance.now() };
		state.__shiftZoomLastDate = null;
	} catch {
		// ignore
	}
	try {
		const prevIdx: number | null = state.animDateIndex ?? null;
		if (prevIdx != null) {
			let list = state.outgoingDates;
			if (!Array.isArray(list)) list = [];
			const t = Math.max(0, Math.min(1, Number(state.hoverAnim) || 0));
			if (t > 0.001) {
				list.push({ index: prevIdx, t });
				if (list.length > 8) {
					list.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0));
					list.length = 8;
				}
				state.outgoingDates = list;
			}
			state.prevAnimDateIndex = prevIdx;
		}
	} catch {
		// ignore
	}
	if (
		state.animSummary &&
		(state.animSummary.dayIndex !== dayIndex || state.animSummary.itemIndex !== itemIndex)
	) {
		const currentSummary = state.animSummary;
		const outgoing = state.outgoingSummaries;
		const t = Math.max(0, Math.min(1, Number(state.hoverAnim) || 0));
		if (t > 0.001) {
			let list = Array.isArray(outgoing) ? outgoing.slice() : [];
			let merged = false;
			for (let i = 0; i < list.length; i++) {
				const o = list[i];
				if (!o) continue;
				if (o.dayIndex === currentSummary.dayIndex && o.itemIndex === currentSummary.itemIndex) {
					o.t = Math.max(Math.max(0, Math.min(1, Number(o.t) || 0)), t);
					merged = true;
					break;
				}
			}
			if (!merged) {
				list.push({ dayIndex: currentSummary.dayIndex, itemIndex: currentSummary.itemIndex, t });
			}
			if (list.length > 8) {
				list.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0));
				list.length = 8;
			}
			state.outgoingSummaries = list;
		}
		state.hoverEaseStartAt = null;
	}
	// Programmatic navigation (Alt+wheel/Alt+arrow/two-finger tap) reuses the same hover model.
	// When switching between targets, restart the hover ease from 0 so the new target
	// animates in (and the previous animates out) instead of snapping at full strength.
	try {
		const switchingSummary = !!prevAnimSummary && (prevAnimSummary.dayIndex !== dayIndex || prevAnimSummary.itemIndex !== itemIndex);
		const switchingFromDate = prevAnimDateIndex != null;
		if (switchingSummary || switchingFromDate) {
			state.hoverAnim = 0;
			state.hoverEaseStartAt = null;
			state.hoverEaseFrom = 0;
			state.hoverEaseTo = 1;
		}
	} catch {
		// ignore
	}
	state.hoverSummary = { dayIndex, itemIndex };
	state.animSummary = { dayIndex, itemIndex };
	state.hoverDateIndex = null;
	state.hoverTarget = 1;
	if (!persistent) {
		state.keepHoverUntilPointerMove = false;
	}
	state.requestHoverAnimation();
}

function findLayoutForDate(canvas: EpochCanvas, date: Date): DayLayout | null {
	const state = getFocusInternals(canvas);
	const today = state.getToday();
	const diffDays = Math.round((today.getTime() - date.getTime()) / MS_PER_DAY);
	return state.layouts.find((layout) => layout.index === diffDays) ?? null;
}

export function getDayIndexForDate(canvas: EpochCanvas, date: Date): number {
	const state = getFocusInternals(canvas);
	const today = state.getToday();
	const toUtcMidnight = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	return Math.round((toUtcMidnight(today) - toUtcMidnight(date)) / MS_PER_DAY);
}

function isDateVisible(canvas: EpochCanvas, dayIndex: number): boolean {
	const state = getFocusInternals(canvas);
	const rect = state.root.getBoundingClientRect();
	const margin = 0;
	const viewTop = margin;
	const viewBottom = rect.height - margin;
	const worldY = dayIndex * BASE_SPACING;
	const yScreen = worldY * state.scale + state.offsetY;
	return yScreen >= viewTop && yScreen <= viewBottom;
}

export function getSourcePriority(source: DateEntry["source"]): number {
	switch (source) {
		case "namedate":
			return 0;
		case "dateprop":
			return 1;
		case "cdate":
			return 2;
		case "content":
			return 3;
		case "tracked":
			return 4;
		default:
			return 10;
	}
}

export function dateKeyToDate(key: string): Date | null {
	const [year, month, day] = key.split("-").map((part) => Number(part));
	if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
		return null;
	}
	const date = new Date(year, month - 1, day);
	return Number.isNaN(date.getTime()) ? null : date;
}
