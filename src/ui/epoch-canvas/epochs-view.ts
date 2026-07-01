import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { selectTimelineEntries } from "../epoch-canvas-utils";
import { getEntriesForDate, isAttachmentEntry } from "../entry-helpers";

import { resetScrollNavTargetState } from "./scroll-nav-reset";

type SemanticRelatedScore = { path?: string };

type EpochRange = { start: string; end: string };

type EpochsPluginState = {
	settings?: {
		generateEpochs?: boolean;
	};
	viewPreferences?: {
		showEpochsView: boolean;
	};
	refreshEpochViews?: () => void;
};

type EpochsCanvasState = {
	plugin?: EpochsPluginState;
	epochsView: boolean;
	epochsViewBucket: unknown;
	epochsViewPrevBucket: unknown;
	epochsViewBucketAnimStart: number | null;
	__epochsPrevSemanticRelatedForPath: string | null;
	__epochsPrevSemanticRelatedPaths: Set<string> | null;
	__epochsPrevSemanticRelatedScored: SemanticRelatedScore[] | null;
	activeFilePath: string | null;
	semanticRelatedPaths: Set<string> | null;
	semanticRelatedScored: SemanticRelatedScore[] | null;
	__epochPackInstantAppearOnce: boolean;
	focusedEpochRange: EpochRange | null;
	semanticRelatedRequestId: number;
	searchQuery: string;
	refreshSemanticRelatedForActiveFile?: (force?: boolean) => void;
	cancelFocusClear: () => void;
	keepHoverUntilPointerMove: boolean;
	keepHoverAfterMenu: boolean;
	hoverDateIndex: number | null;
	hoverSummary: { dayIndex?: number | null } | null;
	animDateIndex: number | null;
	animSummary: { dayIndex?: number | null } | null;
	hoverOverlay: unknown;
	hoverTarget: number;
	hoverAnim: number;
	hoverPreviewKey: string | null;
	lastPointerEvent: unknown;
	modKeyActive: boolean;
	previewLockedNotified: boolean;
	previewLockedUntilAltRelease: boolean;
	scrollNavIndex: number;
	scrollNavFile: string | null;
	pendingScrollNavHighlight: { dayIndex?: number; date?: Date } | null;
	__scrollNavLastModeKey: string | null;
	outgoingSummaries: unknown[];
	outgoingDates: unknown[];
	index: Record<string, DateEntry[]>;
	clearHover: (immediate?: boolean) => void;
	draw: () => void;
	openEntry: (entry: DateEntry) => unknown;
};

function asEpochsState(canvas: EpochCanvas): EpochsCanvasState {
	return canvas as unknown as EpochsCanvasState;
}

export function setEpochsView(canvas: EpochCanvas, value: boolean): void {
	const c = asEpochsState(canvas);
	const next = value === true;
	if (next && c.plugin?.settings?.generateEpochs !== true) return;
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
			try { c.refreshSemanticRelatedForActiveFile?.(true); } catch { void 0; }
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
		c.outgoingSummaries = [];
		c.outgoingDates = [];
	}
	// Switching timeline views should reset scroll-nav state.
	resetScrollNavTargetState(canvas);
	c.scrollNavFile = null;
	c.__scrollNavLastModeKey = null;
	c.clearHover(true);
	// If we were in epochs view, ensure the first normal redraw has the right state.
	if (wasEpochsView) {
		c.pendingScrollNavHighlight = null;
	}
	c.draw();
}

export function setEpochsViewWithToolbar(canvas: EpochCanvas, value: boolean): void {
	const c = asEpochsState(canvas);
	const next = value === true;
	if (c.plugin?.viewPreferences) {
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
	const entries = listRelatedEntriesForEpochRange(canvas, start, end);
	return entries[0] ?? null;
}

export function listRelatedEntriesForEpochRange(canvas: EpochCanvas, start: string, end: string): DateEntry[] {
	const c = asEpochsState(canvas);
	const isDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
	if (!isDateKey(start) || !isDateKey(end)) return [];

	const isSyntheticPinnedTodayClone = (entry: DateEntry): boolean => {
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
	if (keys.length === 0) return [];

	const isNonEpochEntry = (e: DateEntry | null | undefined): boolean => {
		if (!e) return false;
		if (isSyntheticPinnedTodayClone(e)) return false;
		const file = String(e.file || "");
		if (!file) return false;
		return !file.startsWith("epoch://");
	};

	const groupRank = (e: DateEntry): number => {
		const src = String(e.source ?? "");
		if (src === "cdate" || src === "namedate" || src === "dateprop") return 0;
		if (src === "content") return 1;
		if (src === "tracked") return 2;
		return 1;
	};

	const orderByPriority = (entries: DateEntry[]): DateEntry[] => {
		const pool = entries.slice();
		pool.sort((a, b) => {
			const aAttach = isAttachmentEntry(a) ? 1 : 0;
			const bAttach = isAttachmentEntry(b) ? 1 : 0;
			if (aAttach !== bAttach) return aAttach - bAttach;
			const ar = groupRank(a);
			const br = groupRank(b);
			if (ar !== br) return ar - br;
			const af = String(a.file || "");
			const bf = String(b.file || "");
			if (af < bf) return -1;
			if (af > bf) return 1;
			return 0;
		});
		return pool;
	};

	const out: DateEntry[] = [];

	for (const key of keys) {
		const d = new Date(`${key}T00:00:00`);
		// Important: bypass epochsView filtering so we can pick a real note.
		const entries = selectTimelineEntries(getEntriesForDate(canvas, d, { includeAll: true }).filter(isNonEpochEntry));
		if (entries.length === 0) continue;
		const ordered = orderByPriority(entries);
		for (const e of ordered) out.push(e);
	}
	if (out.length > 0) return out;

	for (const key of keys) {
		const raw = Array.isArray(c.index[key]) ? c.index[key] : [];
		const candidates = raw.filter((e) => isNonEpochEntry(e));
		if (candidates.length === 0) continue;
		const ordered = orderByPriority(selectTimelineEntries(candidates));
		for (const e of ordered) out.push(e);
	}

	return out;
}

export function exitEpochsViewAndFocusEpoch(canvas: EpochCanvas, entry: DateEntry): void {
	const c = asEpochsState(canvas);
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
