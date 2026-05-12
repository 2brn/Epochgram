import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { getEventState } from "./state";
import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { findFirstRelatedEntryForEpochRange } from "../epoch-canvas/epochs-view";
import { setCssStyles } from "../../dom";

function isEpochEntry(entry: DateEntry | null | undefined): boolean {
	if (!entry) return false;
	const file = String((entry as any)?.file || "");
	return file.startsWith("epoch://");
}

async function openEpochEntryTarget(
	canvas: EpochCanvas,
	entry: DateEntry,
	ev: { ctrlKey: boolean; metaKey: boolean },
	suppressFocusHover: boolean
): Promise<boolean> {
	const s: any = getEventState(canvas) as any;
	const range = getEpochRangeFromEntry(entry);
	if (!range) return false;
	const first = findFirstRelatedEntryForEpochRange(canvas, range.start, range.end);
	if (!first) return false;
	try {
		(s as any).suppressNextFocusScrollForPath?.(first.file);
	} catch {
		// ignore
	}
	await s.openEntry(first, ev as any, suppressFocusHover);
	return true;
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
	const preserveHoverOnNonPointer = options?.preserveHoverOnNonPointer === true;
	const suppressAutoScrollFor = (ms: number) => {
		try {
			(s as any).__suppressExternalAutoScrollUntil = performance.now() + ms;
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
			(s as any).scrollNavAnchorEntry = best.entry;
			(s as any).scrollNavAnchorDayIndex = best.dayIndex;
		} catch {
			// ignore
		}
		if (s.epochsView && isEpochEntry(best.entry)) {
			await openEpochEntryTarget(canvas, best.entry, { ctrlKey, metaKey }, true);
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
			} else if (!preserveHoverOnNonPointer) {
				s.clearHover();
			}
			return;
		}
		// Clicking a visible record (including dense bars / placeholders) should not
		// trigger a follow-focus scroll as the file becomes active.
		(s as any).suppressNextFocusScrollForPath?.(best.entry.file);
		await s.openEntry(best.entry, { ctrlKey, metaKey } as any, true);
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
			await s.openDateNote(date, { ctrlKey, metaKey } as any, true, {
				allowFallbackToFirstEntry: false
			});
			return;
		}
	}
}

export async function handleTapWithHover(canvas: EpochCanvas, x: number, y: number): Promise<void> {
	const s = getEventState(canvas);
	const suppressAutoScrollFor = (ms: number) => {
		try {
			(s as any).__suppressExternalAutoScrollUntil = performance.now() + ms;
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
			(s as any).scrollNavAnchorEntry = best.entry;
			(s as any).scrollNavAnchorDayIndex = best.dayIndex;
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

		await new Promise(resolve => setTimeout(resolve, 120));
		if (s.epochsView && isEpochEntry(best.entry)) {
			await openEpochEntryTarget(canvas, best.entry, { ctrlKey: false, metaKey: false }, true);
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
				s.setHoverSummary(best.dayIndex, best.itemIndex, true);
			} else {
				s.clearHover();
			}
			return;
		}
		(s as any).suppressNextFocusScrollForPath?.(best.entry.file);
		await s.openEntry(best.entry, { ctrlKey: false, metaKey: false } as any, true);
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

			await new Promise(resolve => setTimeout(resolve, 120));
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
	try {
		(s as any).__suppressExternalAutoScrollUntil = performance.now() + 1000;
	} catch {
		// ignore
	}
	const summaryEntry = s.findSummaryEntryAtPoint(x, y);
	if (summaryEntry) {
		try {
			(s as any).scrollNavAnchorEntry = summaryEntry;
			(s as any).scrollNavAnchorDayIndex = null;
		} catch {
			// ignore
		}
		if (s.epochsView && isEpochEntry(summaryEntry)) {
			await openEpochEntryTarget(canvas, summaryEntry, { ctrlKey: false, metaKey: false }, true);
			if (s.isPointerDeviceEvent()) {
				s.keepHoverUntilPointerMove = true;
			} else {
				s.clearHover();
			}
			return;
		}
		(s as any).suppressNextFocusScrollForPath?.(summaryEntry.file);
		await s.openEntry(summaryEntry, { ctrlKey: false, metaKey: false } as any, true);
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
