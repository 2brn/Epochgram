import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { getEntriesForDate, isAttachmentEntry } from "../entry-helpers";

import { resetScrollNavTargetState } from "./scroll-nav-reset";

export function setEpochsView(canvas: EpochCanvas, value: boolean): void {
	const c: any = canvas as any;
	const next = value === true;
	if (next && c?.plugin?.settings?.generateEpochs !== true) return;
	if (c.epochsView === next) return;
	const wasEpochsView = c.epochsView === true;
	c.epochsView = next;
	c.epochsViewBucket = null;
	c.epochsViewPrevBucket = null;
	c.epochsViewBucketAnimStart = null;
	if (next) {
		// Preserve semantic-related caches so switching back to normal view keeps
		// scroll-nav working across similars immediately.
		c.__epochsPrevSemanticRelatedForPath = c.activeFilePath ?? null;
		c.__epochsPrevSemanticRelatedPaths = c.semanticRelatedPaths ?? null;
		c.__epochsPrevSemanticRelatedScored = c.semanticRelatedScored ?? null;
		c.semanticRelatedPaths = null;
		c.semanticRelatedScored = null;

		// One-shot: on first render after entering epochs view, place records immediately
		// (no fade/tween) to avoid a perceived fade-out on the initial switch.
		c.__epochPackInstantAppearOnce = true;
		c.focusedEpochRange = null;
		c.semanticRelatedRequestId++;
		if (/[!$]similar\b/i.test(String(c.searchQuery || ""))) {
			try { c.refreshSemanticRelatedForActiveFile?.(true); } catch { }
		}
		c.cancelFocusClear();
		c.keepHoverUntilPointerMove = false;
		c.keepHoverAfterMenu = false;
		c.hoverDateIndex = null;
		c.hoverSummary = null;
		c.animDateIndex = null;
		c.animSummary = null;
		c.hoverOverlay = null;
		c.hoverTarget = 0;
		c.hoverAnim = 0;
		c.hoverPreviewKey = null;
		c.lastPointerEvent = null;
		c.modKeyActive = false;
		c.previewLockedNotified = false;
		c.previewLockedUntilAltRelease = false;
		c.scrollNavIndex = -1;
		c.scrollNavFile = null;
		c.pendingScrollNavHighlight = null;
	} else {
		// Restore semantic-related caches if they still match the active file.
		if (
			(c.semanticRelatedPaths == null && c.semanticRelatedScored == null) &&
			(c.__epochsPrevSemanticRelatedForPath ?? null) === (c.activeFilePath ?? null)
		) {
			c.semanticRelatedPaths = c.__epochsPrevSemanticRelatedPaths ?? null;
			c.semanticRelatedScored = c.__epochsPrevSemanticRelatedScored ?? null;
		}
		c.__epochsPrevSemanticRelatedForPath = null;
		c.__epochsPrevSemanticRelatedPaths = null;
		c.__epochsPrevSemanticRelatedScored = null;

		// Exiting epochs view: ensure no stale hover/anim state remains.
		// In particular, animSummary/animDateIndex from epochs layouts can confuse
		// scroll-nav anchoring in normal view (Alt+wheel).
		c.keepHoverUntilPointerMove = false;
		c.keepHoverAfterMenu = false;
		c.hoverDateIndex = null;
		c.hoverSummary = null;
		c.animDateIndex = null;
		c.animSummary = null;
		c.hoverOverlay = null;
		c.hoverTarget = 0;
		c.hoverAnim = 0;
		c.hoverPreviewKey = null;
		c.lastPointerEvent = null;
		c.pendingScrollNavHighlight = null;
		try {
			(c as any).outgoingSummaries = [];
			(c as any).outgoingDates = [];
		} catch {
			// ignore
		}
	}
	// Switching timeline views should reset scroll-nav state.
	resetScrollNavTargetState(canvas);
	c.scrollNavFile = null;
	try {
		(c as any).__scrollNavLastModeKey = null;
	} catch {
		// ignore
	}
	c.clearHover(true);
	// If we were in epochs view, ensure the first normal redraw has the right state.
	if (wasEpochsView) {
		c.pendingScrollNavHighlight = null;
	}
	c.draw();
}

export function setEpochsViewWithToolbar(canvas: EpochCanvas, value: boolean): void {
	const c: any = canvas as any;
	const next = value === true;
	if (c?.plugin?.viewPreferences) {
		c.plugin.viewPreferences.showEpochsView = next;
		try {
			c.plugin.refreshEpochViews?.();
		} catch {
			// ignore
		}
	}
	setEpochsView(canvas, next);
}

export function findFirstRelatedEntryForEpochRange(canvas: EpochCanvas, start: string, end: string): DateEntry | null {
	const c: any = canvas as any;
	const isDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
	if (!isDateKey(start) || !isDateKey(end)) return null;

	const isSyntheticPinnedTodayClone = (entry: any): boolean => {
		try {
			if (!entry || entry.pinned !== true) return false;
			const originalDate = String(entry.originalDate ?? "").trim();
			const date = String(entry.date ?? "").trim();
			return !!originalDate && !!date && originalDate !== date;
		} catch {
			return false;
		}
	};

	const keys = Object.keys(c.index)
		.filter((k) => isDateKey(k) && k >= start && k <= end)
		.sort()
		.reverse();
	if (keys.length === 0) return null;

	const isNonEpochEntry = (e: DateEntry | null | undefined): boolean => {
		if (!e) return false;
		if (isSyntheticPinnedTodayClone(e as any)) return false;
		const file = String((e as any).file || "");
		if (!file) return false;
		return !file.startsWith("epoch://");
	};

	const groupRank = (e: DateEntry): number => {
		const src = String((e as any)?.source ?? "");
		if (src === "cdate" || src === "namedate" || src === "dateprop") return 0;
		if (src === "content") return 1;
		if (src === "tracked") return 2;
		return 1;
	};

	const pickPreferred = (entries: DateEntry[]): DateEntry | null => {
		if (!entries.length) return null;
		const nonAttachments = entries.filter((e) => !isAttachmentEntry(e));
		const pool = nonAttachments.length > 0 ? nonAttachments : entries;
		let best: DateEntry | null = null;
		let bestRank = Number.POSITIVE_INFINITY;
		for (const e of pool) {
			const r = groupRank(e);
			if (r < bestRank) {
				best = e;
				bestRank = r;
				if (bestRank === 0) break;
			}
		}
		return best ?? pool[0] ?? null;
	};

	for (const key of keys) {
		const d = new Date(`${key}T00:00:00`);
		// Important: bypass epochsView filtering so we can pick a real note.
		const entries = getEntriesForDate(canvas, d, { includeAll: true }).filter(isNonEpochEntry);
		if (entries.length === 0) continue;
		const preferred = pickPreferred(entries);
		if (preferred) return preferred;
	}

	for (const key of keys) {
		const raw = Array.isArray(c.index[key]) ? c.index[key] : [];
		const candidates = raw.filter((e: any) => isNonEpochEntry(e));
		if (candidates.length === 0) continue;
		const preferred = pickPreferred(candidates as any);
		if (preferred) return preferred;
	}

	return null;
}

export function exitEpochsViewAndFocusEpoch(canvas: EpochCanvas, entry: DateEntry): void {
	const c: any = canvas as any;
	const range = getEpochRangeFromEntry(entry);
	setEpochsViewWithToolbar(canvas, false);
	c.focusedEpochRange = range ? { start: range.start, end: range.end } : null;
	c.draw();
	if (range) {
		const first = findFirstRelatedEntryForEpochRange(canvas, range.start, range.end);
		if (first) {
			void c.openEntry(first);
		}
	}
}
