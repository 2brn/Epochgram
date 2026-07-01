import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { shouldRenderEntry } from "../epoch-canvas-utils";
import { matchesSearch } from "./search";
import {
	computeEffectiveFilters,
	getSimilarScopeSignature,
	getInheritedMarkIndexByPath,
	getInheritedMarkComputedAt,
	getParsedTimelineQuery,
	isAttachmentEntry,
	isColorMarked,
	isDateKey,
	isDateWithinRange,
	isPropDateEntry,
	state
} from "./shared";

type EntryWithEpochExtras = DateEntry & {
	recurring?: boolean;
	namedDateRange?: boolean;
};

type EpochsViewCanvasState = {
	__indexVersion?: number;
	__epochsViewChildVisibleSig?: string;
	__epochsViewChildVisibleByDateKey?: Map<string, boolean>;
	__epochsViewChildMarkedVisibleSig?: string;
	__epochsViewChildMarkedVisibleByDateKey?: Map<string, boolean>;
};

function computeHasVisibleChildEntryForDate(
	rawEntries: DateEntry[],
	filters: {
		showAttachments: boolean;
		showTrackedChanges: boolean;
		showHidden: boolean;
		hiddenOnly: boolean;
		showDraftOnly: boolean;
		showContentDates: boolean;
		showPropDates: boolean;
	},
	canvas: EpochCanvas,
	inheritedMarkIndexByPath: Map<string, number> | null
): boolean {
	for (const entry of rawEntries) {
		if (!entry) continue;
		try {
			// Synthetic pinned-today entries are clones of the real anchor entry with
			// `date` rewritten to today and `originalDate` set to the real date key.
			// Do not let these clones be the sole reason an epoch is considered to have
			// a visible child under the current filters.
			const pinned = entry.pinned === true;
			const date = typeof entry.date === "string" ? String(entry.date) : "";
			const original = typeof entry.originalDate === "string" ? String(entry.originalDate) : "";
			if (pinned && original && date && original !== date) continue;
		} catch {
			// ignore
		}
		const fp = String(entry.file || "");
		if (!fp || fp.startsWith("epoch://")) continue;

		if (filters.showDraftOnly && !filters.hiddenOnly && entry.reviewState !== "draft") continue;
		if (!filters.showAttachments && isAttachmentEntry(entry)) continue;
		if (!filters.showTrackedChanges) {
			if (entry.source === "tracked") continue;
		}
		if (filters.hiddenOnly && entry.reviewState !== "hidden") continue;
		if (!filters.hiddenOnly && !filters.showHidden && !shouldRenderEntry(entry)) continue;
		const isRecurring = entry.recurring === true;
		const isNamedDateRange = entry.source === "namedate" && (entry as EntryWithEpochExtras).namedDateRange === true;
		if (isNamedDateRange && !filters.showContentDates && !filters.showPropDates) continue;
		if (!filters.showContentDates && entry.source === "content") continue;
		if (!filters.showPropDates && entry.source === "content" && isPropDateEntry(entry) && !isRecurring) continue;
		if (!matchesSearch(canvas, entry)) continue;

		return true;
	}
	return false;
}

function computeHasVisibleMarkedChildEntryForDate(
	rawEntries: DateEntry[],
	filters: {
		showAttachments: boolean;
		showTrackedChanges: boolean;
		showHidden: boolean;
		hiddenOnly: boolean;
		showDraftOnly: boolean;
		showContentDates: boolean;
		showPropDates: boolean;
	},
	canvas: EpochCanvas,
	inheritedMarkIndexByPath: Map<string, number> | null
): boolean {
	for (const entry of rawEntries) {
		if (!entry) continue;
		try {
			// Synthetic pinned-today entries are clones of the real anchor entry with
			// `date` rewritten to today and `originalDate` set to the real date key.
			// Do not let these clones be the sole reason an epoch is considered to have
			// a visible marked child under the current filters.
			const pinned = entry.pinned === true;
			const date = typeof entry.date === "string" ? String(entry.date) : "";
			const original = typeof entry.originalDate === "string" ? String(entry.originalDate) : "";
			if (pinned && original && date && original !== date) continue;
		} catch {
			// ignore
		}
		const fp = String(entry.file || "");
		if (!fp || fp.startsWith("epoch://")) continue;

		if (filters.showDraftOnly && !filters.hiddenOnly && entry.reviewState !== "draft") continue;
		if (!filters.showAttachments && isAttachmentEntry(entry)) continue;
		const isRecurring = entry.recurring === true;
		const isNamedDateRange = entry.source === "namedate" && (entry as EntryWithEpochExtras).namedDateRange === true;
		if (isNamedDateRange && !filters.showContentDates && !filters.showPropDates) continue;
		if (!filters.showContentDates && entry.source === "content") continue;
		if (!filters.showPropDates && entry.source === "content" && isPropDateEntry(entry) && !isRecurring) continue;
		if (!filters.showTrackedChanges) {
			if (entry.source === "tracked") continue;
		}
		if (filters.hiddenOnly && entry.reviewState !== "hidden") continue;
		if (!filters.hiddenOnly && !filters.showHidden && !shouldRenderEntry(entry)) continue;
		if (!matchesSearch(canvas, entry)) continue;
		if (!isColorMarked(entry, inheritedMarkIndexByPath)) continue;

		return true;
	}
	return false;
}

export function getEpochsViewChildVisibilityByDateKey(canvas: EpochCanvas): Map<string, boolean> {
	const cAny = canvas as unknown as EpochsViewCanvasState;
	const s = state(canvas);
	const parsed = getParsedTimelineQuery(canvas);
	const effective = computeEffectiveFilters(canvas, s, parsed);
	const q = String(parsed?.raw || "").trim().toLowerCase();
	const indexVersionRaw = Number(cAny.__indexVersion ?? 0);
	const indexVersion = Number.isFinite(indexVersionRaw) ? indexVersionRaw : 0;
	const inheritedSig = String(getInheritedMarkComputedAt(canvas) || 0);
	const similarScopeSig = getSimilarScopeSignature(canvas, parsed);
	const sig = [
		effective.showAttachments ? "A1" : "A0",
		effective.showTrackedChanges ? "T1" : "T0",
		effective.showHidden ? "H1" : "H0",
		effective.hiddenOnly ? "HO1" : "HO0",
		effective.showDraftOnly ? "D1" : "D0",
		effective.showContentDates ? "C1" : "C0",
		effective.showPropDates ? "P1" : "P0",
		q ? `Q:${q}` : "Q:",
		similarScopeSig ? `S:${similarScopeSig}` : "S:",
		`IM:${inheritedSig}`,
		`IV:${indexVersion}`
	].join("|");

	const prevSig = String(cAny.__epochsViewChildVisibleSig ?? "");
	const prevMap = cAny.__epochsViewChildVisibleByDateKey;
	if (prevSig === sig && prevMap && typeof prevMap.get === "function") {
		return prevMap;
	}

	const out = new Map<string, boolean>();
	const idx = s.index;
	const filters = {
		showAttachments: effective.showAttachments,
		showTrackedChanges: effective.showTrackedChanges,
		showHidden: effective.showHidden,
		hiddenOnly: effective.hiddenOnly,
		showDraftOnly: effective.showDraftOnly,
		showContentDates: effective.showContentDates,
		showPropDates: effective.showPropDates
	};
	const inheritedMarkIndexByPath: Map<string, number> | null = null;

	for (const [key, list] of Object.entries(idx)) {
		if (!isDateKey(key)) continue;
		if (parsed.dateRange && !isDateWithinRange(key, parsed.dateRange)) {
			out.set(key, false);
			continue;
		}
		const raw = Array.isArray(list) ? list : [];
		if (raw.length === 0) {
			out.set(key, false);
			continue;
		}
		out.set(key, computeHasVisibleChildEntryForDate(raw, filters, canvas, inheritedMarkIndexByPath));
	}

	cAny.__epochsViewChildVisibleSig = sig;
	cAny.__epochsViewChildVisibleByDateKey = out;
	return out;
}

export function getEpochsViewMarkedChildVisibilityByDateKey(canvas: EpochCanvas): Map<string, boolean> {
	const cAny = canvas as unknown as EpochsViewCanvasState;
	const s = state(canvas);
	const parsed = getParsedTimelineQuery(canvas);
	const effective = computeEffectiveFilters(canvas, s, parsed);
	// For marked-child visibility we need inherited marks even when not in Marked-only mode.
	const inheritedMarkIndexByPath = getInheritedMarkIndexByPath(canvas);
	const inheritedSig = String(getInheritedMarkComputedAt(canvas) || 0);
	const similarScopeSig = getSimilarScopeSignature(canvas, parsed);
	const indexVersionRaw = Number(cAny.__indexVersion ?? 0);
	const indexVersion = Number.isFinite(indexVersionRaw) ? indexVersionRaw : 0;
	const sig = [
		effective.showAttachments ? "A1" : "A0",
		effective.showTrackedChanges ? "T1" : "T0",
		effective.showHidden ? "H1" : "H0",
		effective.hiddenOnly ? "HO1" : "HO0",
		effective.showDraftOnly ? "D1" : "D0",
		effective.showContentDates ? "C1" : "C0",
		effective.showPropDates ? "P1" : "P0",
		String(parsed?.raw || "").trim().toLowerCase() ? `Q:${String(parsed?.raw || "").trim().toLowerCase()}` : "Q:",
		similarScopeSig ? `S:${similarScopeSig}` : "S:",
		`IM:${inheritedSig}`,
		`IV:${indexVersion}`
	].join("|");

	const prevSig = String(cAny.__epochsViewChildMarkedVisibleSig ?? "");
	const prevMap = cAny.__epochsViewChildMarkedVisibleByDateKey;
	if (prevSig === sig && prevMap && typeof prevMap.get === "function") {
		return prevMap;
	}

	const out = new Map<string, boolean>();
	const idx = s.index;
	const filters = {
		showAttachments: effective.showAttachments,
		showTrackedChanges: effective.showTrackedChanges,
		showHidden: effective.showHidden,
		hiddenOnly: effective.hiddenOnly,
		showDraftOnly: effective.showDraftOnly,
		showContentDates: effective.showContentDates,
		showPropDates: effective.showPropDates
	};

	for (const [key, list] of Object.entries(idx)) {
		if (!isDateKey(key)) continue;
		if (parsed.dateRange && !isDateWithinRange(key, parsed.dateRange)) {
			out.set(key, false);
			continue;
		}
		const raw = Array.isArray(list) ? list : [];
		if (raw.length === 0) {
			out.set(key, false);
			continue;
		}
		out.set(key, computeHasVisibleMarkedChildEntryForDate(raw, filters, canvas, inheritedMarkIndexByPath));
	}

	cAny.__epochsViewChildMarkedVisibleSig = sig;
	cAny.__epochsViewChildMarkedVisibleByDateKey = out;
	return out;
}
