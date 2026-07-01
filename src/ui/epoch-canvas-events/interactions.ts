import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { getEventState } from "./state";
import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { listRelatedEntriesForEpochRange } from "../epoch-canvas/epochs-view";
import { setCssStyles } from "../../dom";

type OpenModifiers = Pick<MouseEvent, "ctrlKey" | "metaKey">;

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

type CanvasInteractionState = ReturnType<typeof getEventState> & {
	__suppressExternalAutoScrollUntil?: number;
	__epochOpenCursor?: EpochOpenCursorState;
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
		summaryRects: Array<{ x1: number; x2: number; y1: number; y2: number; itemIndex: number; entry: DateEntry }>;
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
		| { dayIndex: number; itemIndex: number; entry: DateEntry; dist: number }
		| null = null;
	for (const day of s.layouts) {
		for (const summary of day.summaryRects) {
			if (!(x >= summary.x1 && x <= summary.x2 && y >= summary.y1 && y <= summary.y2)) continue;
			const cy = (summary.y1 + summary.y2) / 2;
			const d = Math.abs(y - cy);
			if (!best || d < best.dist) {
				best = { dayIndex: day.index, itemIndex: summary.itemIndex, entry: summary.entry, dist: d };
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
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
				setCssStyles(s.canvas, { cursor: "pointer" });
			} else if (!preserveHoverOnNonPointer) {
				s.clearHover();
			}
			return;
		}
		// Clicking a visible record (including dense bars / placeholders) should not
		// trigger a follow-focus scroll as the file becomes active.
			interactionState.suppressNextFocusScrollForPath?.(best.entry.file);
			await interactionState.openEntry(best.entry, { ctrlKey, metaKey }, true);
		if (s.isPointerDeviceEvent()) {
			s.keepHoverUntilPointerMove = true;
			s.setHoverSummary(best.dayIndex, best.itemIndex, true);
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
		| { dayIndex: number; itemIndex: number; entry: DateEntry; dist: number }
		| null = null;
	for (const day of s.layouts) {
		for (const summary of day.summaryRects) {
			if (!(x >= summary.x1 && x <= summary.x2 && y >= summary.y1 && y <= summary.y2)) continue;
			const cy = (summary.y1 + summary.y2) / 2;
			const d = Math.abs(y - cy);
			if (!best || d < best.dist) {
				best = { dayIndex: day.index, itemIndex: summary.itemIndex, entry: summary.entry, dist: d };
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
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
				setCssStyles(s.canvas, { cursor: "pointer" });
			} else {
				s.clearHover();
			}
			return;
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
