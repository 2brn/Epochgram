import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { getEventState } from "./state";
import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { listRelatedEntriesForEpochRange } from "../epoch-canvas/epochs-view";
import { getEntriesForDate } from "../entry-helpers";
import { setCssStyles } from "../../dom";

type OpenModifiers = Pick<MouseEvent, "ctrlKey" | "metaKey">;

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

type CanvasInteractionState = ReturnType<typeof getEventState> & {
	__suppressExternalAutoScrollUntil?: number;
	__epochOpenCursor?: EpochOpenCursorState;
	__compactOpenCursor?: CompactOpenCursorState;
	activeFilePath?: string | null;
	scrollNavAnchorEntry?: DateEntry;
	scrollNavAnchorDayIndex?: number | null;
	suppressNextFocusScrollForPath?(path: string): void;
	openEntry(entry: DateEntry, ev: OpenModifiers, suppressFocusHover: boolean): Promise<void>;
	openDateNote(date: Date, ev: OpenModifiers | undefined, focus: boolean, options?: { allowFallbackToFirstEntry?: boolean }): Promise<boolean>;
	keepHoverUntilPointerMove: boolean;
	hoverSummary: { dayIndex: number; itemIndex: number } | null;
	hoverDateIndex: number | null;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	animDateIndex: number | null;
	hoverTarget: number;
	requestHoverAnimation(): void;
	clearHover(force?: boolean): void;
	findSummaryEntryAtPoint(x: number, y: number): DateEntry | null;
	findDayLayoutAtPoint(x: number, y: number): { index: number } | null;
	createNoteForDate(date: Date, focus: boolean): Promise<void>;
	resetScrollNavToToday(): void;
	getToday(): Date;
	getDateForIndex(index: number, today: Date): Date;
	epochsView?: boolean;
	isPointerDeviceEvent(): boolean;
	layouts: Array<{
		hasVisibleDate: boolean;
		index: number;
		dateRect: { x1: number; x2: number; y1: number; y2: number };
		summaryRects: Array<{
			x1: number;
			x2: number;
			y1: number;
			y2: number;
			itemIndex: number;
			entry: DateEntry;
			compactTotalCount?: number;
			compactHiddenCount?: number;
		}>;
	}>;
	canvas: HTMLCanvasElement;
};

function isEpochEntry(entry: DateEntry | null | undefined): boolean {
	if (!entry) return false;
	const file = String(entry.file || "");
	return file.startsWith("epoch://");
}

async function openEpochEntryTarget(
	canvas: EpochCanvas,
	entry: DateEntry,
	ev: { ctrlKey: boolean; metaKey: boolean },
	suppressFocusHover: boolean
): Promise<boolean> {
	const s = getEventState(canvas) as CanvasInteractionState;
	const range = getEpochRangeFromEntry(entry);
	if (!range) return false;
	const next = pickNextEpochEntryFromRange(canvas, range.start, range.end, s);
	if (!next) return false;
	try {
		s.suppressNextFocusScrollForPath?.(next.file);
	} catch {
		// ignore
	}
	await s.openEntry(next, ev, suppressFocusHover);
	return true;
}

type EpochOpenCursorState = {
	key: string;
	index: number;
};

type CompactOpenCursorState = {
	key: string;
	index: number;
	openedPath: string;
};

function makeDateKey(date: Date): string {
	try {
		return date.toISOString().slice(0, 10);
	} catch {
		return "";
	}
}

function getEntriesForDateSafe(canvas: EpochCanvas, date: Date): DateEntry[] {
	try {
		const entries = getEntriesForDate(canvas, date);
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

export function pickNextCompactEntryFromDayRange(
	canvas: EpochCanvas,
	dayIndex: number,
	itemIndex: number,
	compactTotalCount: number,
	state: CanvasInteractionState & { __compactOpenCursor?: CompactOpenCursorState }
): DateEntry | null {
	const today = state.getToday();
	const date = state.getDateForIndex(dayIndex, today);
	const dayEntries = getEntriesForDateSafe(canvas, date);
	if (!Array.isArray(dayEntries) || dayEntries.length === 0) return null;

	const start = Number(itemIndex);
	const total = Math.min(dayEntries.length, Math.max(0, Number(compactTotalCount)));
	if (!Number.isFinite(start) || !Number.isFinite(total)) return null;
	if (start < 0 || start >= total) return null;

	const ordered = dayEntries.slice(start, total);
	if (ordered.length === 0) return null;
	const activePath = String(state.activeFilePath ?? "");

	const key = `${dayIndex}|${makeDateKey(date)}|${start}|${total}`;
	const prev = state.__compactOpenCursor ?? null;
	let index = 0;
	const activeMatchesPrevious = !!activePath && !!prev?.openedPath && activePath === prev.openedPath;
	if (prev && prev.key === key && activeMatchesPrevious) {
		const lastIndex = Number(prev.index);
		if (Number.isInteger(lastIndex) && lastIndex >= 0) {
			index = (lastIndex + 1) % ordered.length;
		}
	}
	const next = ordered[index] ?? null;
	if (!next) return null;
	state.__compactOpenCursor = { key, index, openedPath: String(next.file || "") };
	return next;
}

async function openCompactCollapsedEntryTarget(
	canvas: EpochCanvas,
	dayIndex: number,
	itemIndex: number,
	compactTotalCount: number,
	ev: { ctrlKey: boolean; metaKey: boolean },
	suppressFocusHover: boolean
): Promise<boolean> {
	const s = getEventState(canvas) as CanvasInteractionState;
	const next = pickNextCompactEntryFromDayRange(canvas, dayIndex, itemIndex, compactTotalCount, s);
	if (!next) return false;
	try {
		s.suppressNextFocusScrollForPath?.(next.file);
	} catch {
		// ignore
	}
	await s.openEntry(next, ev, suppressFocusHover);
	return true;
}

export function pickNextEpochEntryFromRange(canvas: EpochCanvas, start: string, end: string, state: CanvasInteractionState & { __epochOpenCursor?: EpochOpenCursorState }): DateEntry | null {
	const ordered = listRelatedEntriesForEpochRange(canvas, start, end);
	if (!ordered.length) return null;
	const key = `${start}|${end}`;
	const prev: EpochOpenCursorState | null = state && typeof state === "object"
		? (state.__epochOpenCursor ?? null)
		: null;
	let index = 0;
	if (prev && prev.key === key) {
		const lastIndex = Number(prev.index);
		if (Number.isInteger(lastIndex) && lastIndex >= 0) {
			index = (lastIndex + 1) % ordered.length;
		}
	}
	if (state && typeof state === "object") {
		state.__epochOpenCursor = { key, index };
	}
	return ordered[index] ?? null;
}

export async function handlePointClick(
	canvas: EpochCanvas,
	x: number,
	y: number,
	ctrlKey: boolean,
	metaKey: boolean,
	options?: { preserveHoverOnNonPointer?: boolean }
): Promise<void> {
	const s = getEventState(canvas);
	const interactionState = s as CanvasInteractionState;
	const preserveHoverOnNonPointer = options?.preserveHoverOnNonPointer === true;
	const suppressAutoScrollFor = (ms: number) => {
		try {
			interactionState.__suppressExternalAutoScrollUntil = nowMs() + ms;
		} catch {
			// ignore
		}
	};
	let best:
		| {
			dayIndex: number;
			itemIndex: number;
			entry: DateEntry;
			dist: number;
			compactTotalCount?: number;
			compactHiddenCount?: number;
		}
		| null = null;
	for (const day of s.layouts) {
		for (const summary of day.summaryRects) {
			if (!(x >= summary.x1 && x <= summary.x2 && y >= summary.y1 && y <= summary.y2)) continue;
			const cy = (summary.y1 + summary.y2) / 2;
			const d = Math.abs(y - cy);
			if (!best || d < best.dist) {
				best = {
					dayIndex: day.index,
					itemIndex: summary.itemIndex,
					entry: summary.entry,
					dist: d,
					compactTotalCount: summary.compactTotalCount,
					compactHiddenCount: summary.compactHiddenCount
				};
			}
		}
	}

	if (best) {
		suppressAutoScrollFor(1000);
		try {
			s.scrollNavAnchorEntry = best.entry;
			s.scrollNavAnchorDayIndex = best.dayIndex;
		} catch {
			// ignore
		}
		if (s.epochsView && isEpochEntry(best.entry)) {
			await openEpochEntryTarget(canvas, best.entry, { ctrlKey, metaKey }, true);
			try {
				s.scrollNavAnchorEntry = best.entry;
				s.scrollNavAnchorDayIndex = best.dayIndex;
			} catch {
				// ignore
			}
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
				setCssStyles(s.canvas, { cursor: "pointer" });
			} else if (!preserveHoverOnNonPointer) {
				s.clearHover();
			}
			return;
		}
		const compactHiddenCount = Number(best.compactHiddenCount ?? 0);
		const compactTotalCount = Number(best.compactTotalCount ?? 0);
		if (!s.epochsView && compactHiddenCount > 0 && compactTotalCount > best.itemIndex + 1) {
			const opened = await openCompactCollapsedEntryTarget(
				canvas,
				best.dayIndex,
				best.itemIndex,
				compactTotalCount,
				{ ctrlKey, metaKey },
				true
			);
			if (opened) {
				const cursor = interactionState.__compactOpenCursor;
				const cycleOffset = cursor ? Number(cursor.index) : 0;
				const anchorIndex = Number.isFinite(cycleOffset) && cycleOffset >= 0
					? Math.min(Math.max(0, best.itemIndex + cycleOffset), Math.max(best.itemIndex, compactTotalCount - 1))
					: best.itemIndex;
				const today = s.getToday();
				const date = s.getDateForIndex(best.dayIndex, today);
				const dayEntries = getEntriesForDateSafe(canvas, date);
				const anchorEntry = dayEntries[anchorIndex] ?? best.entry;
				try {
					s.scrollNavAnchorEntry = anchorEntry;
					s.scrollNavAnchorDayIndex = best.dayIndex;
				} catch {
					// ignore
				}
				if (s.isPointerDeviceEvent()) {
					s.keepHoverUntilPointerMove = true;
					s.setHoverSummary(best.dayIndex, best.itemIndex, true);
					setCssStyles(s.canvas, { cursor: "pointer" });
				} else if (!preserveHoverOnNonPointer) {
					s.clearHover();
				}
				return;
			}
		}
		// Clicking a visible record (including dense bars / placeholders) should not
		// trigger a follow-focus scroll as the file becomes active.
			interactionState.suppressNextFocusScrollForPath?.(best.entry.file);
			await interactionState.openEntry(best.entry, { ctrlKey, metaKey }, true);
		if (s.isPointerDeviceEvent()) {
			s.keepHoverUntilPointerMove = true;
			s.setHoverSummary(best.dayIndex, best.itemIndex, true);
				setCssStyles(s.canvas, { cursor: "pointer" });
		} else if (!preserveHoverOnNonPointer) {
			s.clearHover();
		}
		return;
	}

	for (const day of s.layouts) {
		if (!day.hasVisibleDate) continue;
		const rect = day.dateRect;
		if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) {
			suppressAutoScrollFor(1000);
			const today = s.getToday();
			const date = s.getDateForIndex(day.index, today);
			await interactionState.openDateNote(date, { ctrlKey, metaKey }, true, {
				allowFallbackToFirstEntry: false
			});
			return;
		}
	}
}

export async function handleTapWithHover(canvas: EpochCanvas, x: number, y: number): Promise<void> {
	const s = getEventState(canvas);
	const interactionState = s as CanvasInteractionState;
	const suppressAutoScrollFor = (ms: number) => {
		try {
			interactionState.__suppressExternalAutoScrollUntil = nowMs() + ms;
		} catch {
			// ignore
		}
	};
	let best:
		| {
			dayIndex: number;
			itemIndex: number;
			entry: DateEntry;
			dist: number;
			compactTotalCount?: number;
			compactHiddenCount?: number;
		}
		| null = null;
	for (const day of s.layouts) {
		for (const summary of day.summaryRects) {
			if (!(x >= summary.x1 && x <= summary.x2 && y >= summary.y1 && y <= summary.y2)) continue;
			const cy = (summary.y1 + summary.y2) / 2;
			const d = Math.abs(y - cy);
			if (!best || d < best.dist) {
				best = {
					dayIndex: day.index,
					itemIndex: summary.itemIndex,
					entry: summary.entry,
					dist: d,
					compactTotalCount: summary.compactTotalCount,
					compactHiddenCount: summary.compactHiddenCount
				};
			}
		}
	}

	if (best) {
		suppressAutoScrollFor(1000);
		try {
			interactionState.scrollNavAnchorEntry = best.entry;
			interactionState.scrollNavAnchorDayIndex = best.dayIndex;
		} catch {
			// ignore
		}
		s.keepHoverUntilPointerMove = false;
		s.hoverSummary = { dayIndex: best.dayIndex, itemIndex: best.itemIndex };
		s.hoverDateIndex = null;
		s.animSummary = { dayIndex: best.dayIndex, itemIndex: best.itemIndex };
		s.animDateIndex = null;
		setCssStyles(s.canvas, { cursor: "pointer" });
		s.hoverTarget = 1;
		s.requestHoverAnimation();

		await new Promise(resolve => window.setTimeout(resolve, 120));
		if (s.epochsView && isEpochEntry(best.entry)) {
			await openEpochEntryTarget(canvas, best.entry, { ctrlKey: false, metaKey: false }, true);
			try {
				s.scrollNavAnchorEntry = best.entry;
				s.scrollNavAnchorDayIndex = best.dayIndex;
			} catch {
				// ignore
			}
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
				setCssStyles(s.canvas, { cursor: "pointer" });
			} else {
				s.clearHover();
			}
			return;
		}
		const compactHiddenCount = Number(best.compactHiddenCount ?? 0);
		const compactTotalCount = Number(best.compactTotalCount ?? 0);
		if (!s.epochsView && compactHiddenCount > 0 && compactTotalCount > best.itemIndex + 1) {
			const opened = await openCompactCollapsedEntryTarget(
				canvas,
				best.dayIndex,
				best.itemIndex,
				compactTotalCount,
				{ ctrlKey: false, metaKey: false },
				true
			);
			if (opened) {
				if (s.isPointerDeviceEvent()) {
					s.keepHoverUntilPointerMove = true;
					s.setHoverSummary(best.dayIndex, best.itemIndex, true);
					setCssStyles(s.canvas, { cursor: "pointer" });
				} else {
					s.clearHover();
				}
				return;
			}
		}
		interactionState.suppressNextFocusScrollForPath?.(best.entry.file);
		await interactionState.openEntry(best.entry, { ctrlKey: false, metaKey: false }, true);
		if (s.isPointerDeviceEvent()) {
			s.keepHoverUntilPointerMove = true;
			s.setHoverSummary(best.dayIndex, best.itemIndex, true);
		} else {
			s.clearHover();
		}
		return;
	}

	for (const day of s.layouts) {
		if (!day.hasVisibleDate) continue;
		const rect = day.dateRect;
		if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) {
			suppressAutoScrollFor(1000);
			s.hoverSummary = null;
			s.hoverDateIndex = day.index;
			s.animSummary = null;
			s.animDateIndex = day.index;
			setCssStyles(s.canvas, { cursor: "pointer" });
			s.hoverTarget = 1;
			s.requestHoverAnimation();

			await new Promise(resolve => window.setTimeout(resolve, 120));
			const today = s.getToday();
			const date = s.getDateForIndex(day.index, today);
			await s.openDateNote(date, undefined, true, { allowFallbackToFirstEntry: false });
			s.clearHover();
			return;
		}
	}
}

export async function handleDoublePoint(canvas: EpochCanvas, x: number, y: number): Promise<void> {
	const s = getEventState(canvas);
	const interactionState = s as CanvasInteractionState;
	try {
		interactionState.__suppressExternalAutoScrollUntil = nowMs() + 1000;
	} catch {
		// ignore
	}
	const summaryEntry = s.findSummaryEntryAtPoint(x, y);
	if (summaryEntry) {
		try {
			interactionState.scrollNavAnchorEntry = summaryEntry;
			interactionState.scrollNavAnchorDayIndex = null;
		} catch {
			// ignore
		}
		if (s.epochsView && isEpochEntry(summaryEntry)) {
			await openEpochEntryTarget(canvas, summaryEntry, { ctrlKey: false, metaKey: false }, true);
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				setCssStyles(s.canvas, { cursor: "pointer" });
			} else {
				s.clearHover();
			}
			return;
		}
		interactionState.suppressNextFocusScrollForPath?.(summaryEntry.file);
		await s.openEntry(summaryEntry, undefined, true);
		if (s.isPointerDeviceEvent()) {
			s.keepHoverUntilPointerMove = true;
			setCssStyles(s.canvas, { cursor: "pointer" });
			setCssStyles(s.canvas, { cursor: "pointer" });
		} else {
			s.clearHover();
		}
		return;
	}

	const day = s.findDayLayoutAtPoint(x, y);
	if (day) {
		const today = s.getToday();
		const date = s.getDateForIndex(day.index, today);
		await s.createNoteForDate(date, false);
		return;
	}

	s.resetScrollNavToToday();
}
