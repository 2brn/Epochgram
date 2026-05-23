import { MAX_MARK_COLORS } from "../ui/mark-colors";
import type { DateEntry, FileIndexData, FileReviewState } from "./types";
import {
	applyHighlightState,
	entryEffectiveDate,
	entrySignature,
	gatherFileEntries,
	trackedEntryKey
} from "./entry-state";

interface EntryUpdatesState {
	files: Record<string, FileIndexData>;
	plugin: any;
	updateAggregatedEntries(filePath: string, options?: { skipSort?: boolean }): void;
}

function state(indexer: any): EntryUpdatesState {
	return indexer as EntryUpdatesState;
}

function normalizeMarkColor(markColor: number | null): number | null {
	if (typeof markColor !== "number" || !Number.isFinite(markColor) || markColor <= 0) {
		return null;
	}
	return Math.max(1, Math.min(MAX_MARK_COLORS, Math.floor(markColor)));
}

function normalizeFileReviewState(value: any): FileReviewState {
	if (typeof value !== "string") return "draft";
	const s = value.trim().toLowerCase();
	return s === "reviewed" || s === "draft" ? (s as FileReviewState) : "draft";
}

function isDateKey(value: any): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

export function setEntryReviewState(indexer: any, target: DateEntry, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data: any = s.files[target.file];
	if (!data) return false;

	const dayKey = String((target as any)?.date || "").trim();
	if (!isDateKey(dayKey)) return false;
	const desired = normalizeFileReviewState(reviewState);
	let changed = false;

	// Setting Draft/Reviewed for a record should unhide that record.
	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	const related = (() => {
		const canGroupByDay = (target as any)?.recurring !== true;
		const matches = (() => {
			if (!canGroupByDay) return [] as DateEntry[];
			try {
				return entries.filter((e) => String((e as any)?.date || "") === dayKey);
			} catch {
				return [] as DateEntry[];
			}
		})();
		const fallbackMatches = (() => {
			try {
				const keyFor = (e: DateEntry): string => (e.source === "tracked" ? trackedEntryKey(e) : entrySignature(e));
				const targetKey = keyFor(target);
				if (!targetKey) return [] as DateEntry[];
				return entries.filter((e) => keyFor(e) === targetKey);
			} catch {
				return [] as DateEntry[];
			}
		})();
		return matches.length > 0 ? matches : fallbackMatches;
	})();

	if (related.length === 0) {
		// Synthetic recurring occurrences are virtual (not stored as entries), so persist review
		// state using date-key lists on the file index data.
		try {
			if ((data as any)?.recur) {
				const listRaw: any = (data as any).recurReviewedDates;
				const list: string[] = Array.isArray(listRaw) ? listRaw.map((v) => String(v || "").trim()).filter(Boolean) : [];
				const set = new Set<string>(list.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)));
				const had = set.has(dayKey);
				if (desired === "reviewed") set.add(dayKey);
				else set.delete(dayKey);
				const changedRecurReviewed = desired === "reviewed" ? !had : had;
				if (changedRecurReviewed) {
					(data as any).recurReviewedDates = Array.from(set).sort((a, b) => a.localeCompare(b));
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		// Also unhide recurring occurrences when reviewing/drafting.
		try {
			const raw: any = (data as any)?.recurHiddenDates;
			if (Array.isArray(raw) && raw.length > 0) {
				const next = raw.map((v: any) => String(v || "").trim()).filter(Boolean).filter((k: string) => k !== dayKey);
				if (next.length !== raw.length) {
					(data as any).recurHiddenDates = next;
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		try {
			if (desired === "reviewed") (target as any).reviewState = "reviewed";
			else if ((target as any)?.reviewState != null) delete (target as any).reviewState;
		} catch {
			// ignore
		}
		if (!changed) return false;
		s.updateAggregatedEntries(target.file);
		return true;
	}

	for (const entry of related) {
		try {
			if (desired === "draft") {
				if ((entry as any)?.reviewState != null) {
					delete (entry as any).reviewState;
					changed = true;
				}
			} else {
				if ((entry as any)?.reviewState !== "reviewed") {
					(entry as any).reviewState = "reviewed";
					changed = true;
				}
			}
		} catch {
			// ignore
		}
	}

	try {
		if (desired === "reviewed") (target as any).reviewState = "reviewed";
		else if ((target as any)?.reviewState != null) delete (target as any).reviewState;
	} catch {
		// ignore
	}

	if (!changed) return false;
	s.updateAggregatedEntries(target.file);
	return true;
}

export function setEntryHidden(indexer: any, target: DateEntry, hidden: boolean): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data = s.files[target.file];
	if (!data) return false;

	const dayKey = String((target as any)?.date || "").trim();
	const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(dayKey);
	const updateRecurringHidden = (): boolean => {
		try {
			// Only relevant when the note actually has a recurrence schedule.
			if (!(data as any)?.recur) return false;
			if (!isDateKey) return false;
			const listRaw: any = (data as any).recurHiddenDates;
			const list: string[] = Array.isArray(listRaw) ? listRaw.map((v) => String(v || "").trim()).filter(Boolean) : [];
			const set = new Set<string>(list.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)));
			const had = set.has(dayKey);
			if (hidden) set.add(dayKey);
			else set.delete(dayKey);
			const changed = hidden ? !had : had;
			if (!changed) return false;
			(data as any).recurHiddenDates = Array.from(set).sort((a, b) => a.localeCompare(b));
			return true;
		} catch {
			return false;
		}
	};

	const entries = gatherFileEntries(data);
	if (entries.length === 0) return false;

	// Hide/Show applies to *all* records from this note for this day.
	// (Fallback to signature-based matching when there are no same-day file entries,
	// e.g. pinned-today synthetic entries that map back to an anchor entry.)
	const matches = dayKey
		? entries.filter((e) => String((e as any)?.date || "") === dayKey)
		: [];
	const fallbackMatches = (() => {
		const keyFor = (e: DateEntry): string => (e.source === "tracked" ? trackedEntryKey(e) : entrySignature(e));
		const targetKey = keyFor(target);
		if (!targetKey) return [];
		return entries.filter((e) => keyFor(e) === targetKey);
	})();
	const related = matches.length > 0 ? matches : fallbackMatches;
	if (related.length === 0) {
		const changedRecurring = updateRecurringHidden();
		if (!changedRecurring) return false;
		(target as any).reviewState = hidden ? "hidden" : undefined;
		s.updateAggregatedEntries(target.file);
		return true;
	}

	let changed = false;
	for (const entry of related) {
		if (hidden) {
			if (entry.reviewState !== "hidden") {
				entry.reviewState = "hidden";
				changed = true;
			}
		} else {
			if (entry.reviewState === "hidden") {
				delete entry.reviewState;
				changed = true;
			}
		}
	}
	const changedRecurring = updateRecurringHidden();
	if (changedRecurring) changed = true;
	if (!changed) return false;

	target.reviewState = hidden ? "hidden" : undefined;
	s.updateAggregatedEntries(target.file);
	return true;
}

export function setFileHidden(indexer: any, path: string, hidden: boolean): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data: any = s.files[p];
	if (!data) return false;

	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	if (entries.length === 0) return false;

	const currentlyHidden = entries.every((e) => (e as any)?.reviewState === "hidden");
	if (hidden === currentlyHidden) return false;

	let changed = false;
	if (hidden) {
		try {
			for (const entry of entries) {
				if ((entry as any)?.reviewState !== "hidden") {
					(entry as any).reviewState = "hidden";
					changed = true;
				}
			}
		} catch {
			// ignore
		}
	}

	// When showing a file, un-hide all hidden overrides and reset review to Draft.
	if (!hidden) {
		try {
			for (const entry of entries) {
				if ((entry as any)?.reviewState === "hidden") {
					delete (entry as any).reviewState;
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		try {
			for (const entry of entries) {
				if ((entry as any)?.reviewState === "reviewed") {
					delete (entry as any).reviewState;
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		try {
			if (Array.isArray((data as any)?.recurHiddenDates) && (data as any).recurHiddenDates.length > 0) {
				(data as any).recurHiddenDates = [];
				changed = true;
			}
		} catch {
			// ignore
		}
		try {
			if (Array.isArray((data as any)?.recurReviewedDates) && (data as any).recurReviewedDates.length > 0) {
				(data as any).recurReviewedDates = [];
				changed = true;
			}
		} catch {
			// ignore
		}
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function isFileHidden(indexer: any, path: string): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data: any = s.files[p];
	if (!data) return false;
	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	if (entries.length === 0) return false;
	return entries.every((e) => (e as any)?.reviewState === "hidden");
}

export function setFileReviewStateForAllRecords(indexer: any, path: string, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data: any = s.files[p];
	if (!data) return false;

	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	if (entries.length === 0) return false;

	const desired = normalizeFileReviewState(reviewState);
	let changed = false;

	// Setting Draft/Reviewed should unhide all records in this file.
	try {
		for (const entry of entries) {
			if ((entry as any)?.reviewState === "hidden") {
				delete (entry as any).reviewState;
				changed = true;
			}
		}
	} catch {
		// ignore
	}
	try {
		if (Array.isArray((data as any)?.recurHiddenDates) && (data as any).recurHiddenDates.length > 0) {
			(data as any).recurHiddenDates = [];
			changed = true;
		}
	} catch {
		// ignore
	}

	try {
		for (const entry of entries) {
			if (desired === "draft") {
				if ((entry as any)?.reviewState === "reviewed") {
					delete (entry as any).reviewState;
					changed = true;
				}
				if ((entry as any)?.reviewState === "hidden") {
					delete (entry as any).reviewState;
					changed = true;
				}
			} else {
				if ((entry as any)?.reviewState !== "reviewed") {
					(entry as any).reviewState = "reviewed";
					changed = true;
				}
			}
		}
	} catch {
		// ignore
	}
	if (desired === "draft") {
		try {
			if (Array.isArray((data as any)?.recurReviewedDates) && (data as any).recurReviewedDates.length > 0) {
				(data as any).recurReviewedDates = [];
				changed = true;
			}
		} catch {
			// ignore
		}
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function setFileReviewStateForAllRecordsPreserveHidden(indexer: any, path: string, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data: any = s.files[p];
	if (!data) return false;

	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	if (entries.length === 0) return false;

	const desired = normalizeFileReviewState(reviewState);
	let changed = false;
	try {
		for (const entry of entries) {
			if ((entry as any)?.reviewState === "hidden") continue;
			if (desired === "draft") {
				if ((entry as any)?.reviewState === "reviewed") {
					delete (entry as any).reviewState;
					changed = true;
				}
			} else {
				if ((entry as any)?.reviewState !== "reviewed") {
					(entry as any).reviewState = "reviewed";
					changed = true;
				}
			}
		}
	} catch {
		// ignore
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function clearFileReviewOverrides(indexer: any, path: string): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data: any = s.files[p];
	if (!data) return false;
	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	let changed = false;
	try {
		for (const entry of entries) {
			if ((entry as any)?.reviewState === "reviewed") {
				delete (entry as any).reviewState;
				changed = true;
			}
		}
	} catch {
		// ignore
	}
	try {
		if (Array.isArray((data as any)?.recurReviewedDates) && (data as any).recurReviewedDates.length > 0) {
			(data as any).recurReviewedDates = [];
			changed = true;
		}
	} catch {
		// ignore
	}
	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function toggleFileVisibility(indexer: any, path: string): "hidden" | "visible" | null {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return null;
	const data: any = s.files[p];
	if (!data) return null;

	const entries = (() => {
		try {
			return gatherFileEntries(data);
		} catch {
			return [] as DateEntry[];
		}
	})();
	if (entries.length === 0) return null;

	const currentlyHidden = entries.every((e) => (e as any)?.reviewState === "hidden");
	const changed = setFileHidden(indexer, p, !currentlyHidden);
	if (!changed) return null;
	return !currentlyHidden ? "hidden" : "visible";
}

export function getFileMarkColor(indexer: any, path: string): number | null {
	const s = state(indexer);
	const data: any = s.files[path];
	if (!data) return null;
	const mark = typeof data.markColor === "number" ? data.markColor : null;
	return mark;
}

export function cycleFileMarkColor(indexer: any, path: string): boolean {
	const current = getFileMarkColor(indexer, path);
	const next = current == null ? 1 : ((Math.floor(current) % MAX_MARK_COLORS) + 1);
	return setFileMarkColor(indexer, path, next);
}

export function clearEntryAiSummary(indexer: any, target: DateEntry): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data = s.files[target.file];
	if (!data) return false;

	const entries = gatherFileEntries(data);
	if (entries.length === 0) return false;

	const targetDate = entryEffectiveDate(target);
	let related = targetDate
		? entries.filter(entry => entryEffectiveDate(entry) === targetDate)
		: [];
	if (related.length === 0) {
		const targetSig = entrySignature(target);
		related = entries.filter(entry => entrySignature(entry) === targetSig);
	}
	if (related.length === 0) return false;

	let changed = false;
	for (const entry of related) {
		const anyEntry: any = entry as any;
		const prevS = typeof anyEntry.aiSummary === "string" ? anyEntry.aiSummary.trim() : "";
		const prevH = typeof anyEntry.aiSummaryInputHash === "string" ? anyEntry.aiSummaryInputHash.trim() : "";
		if (!prevS && !prevH) continue;
		try {
			delete anyEntry.aiSummary;
			delete anyEntry.aiSummaryInputHash;
			delete anyEntry.aiSummaryVisible;
		} catch {
			// ignore
		}
		changed = true;
	}

	if (!changed) return false;
	try {
		delete (target as any).aiSummary;
		delete (target as any).aiSummaryInputHash;
		delete (target as any).aiSummaryVisible;
	} catch {
		// ignore
	}
	s.updateAggregatedEntries(target.file);
	return true;
}

export function clearFileSummaryState(indexer: any, path: string): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return false;

	const clearEntry = (entry: any): boolean => {
		if (!entry) return false;
		const prevAi = typeof entry.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const prevHash = typeof entry.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		if (!prevAi && !prevHash && entry.aiSummaryVisible !== true) return false;
		try {
			delete entry.aiSummary;
			delete entry.aiSummaryInputHash;
			delete entry.aiSummaryVisible;
		} catch {
			// ignore
		}
		return true;
	};

	let changed = false;
	if (clearEntry((data as any).cdate)) changed = true;
	if (clearEntry((data as any).namedDate)) changed = true;
	if (clearEntry((data as any).dateProp)) changed = true;
	for (const entry of Array.isArray((data as any).contentDates) ? (data as any).contentDates : []) {
		if (clearEntry(entry)) changed = true;
	}
	const tracked = (data as any)?.trackedDates ?? {};
	for (const list of Object.values(tracked)) {
		for (const entry of Array.isArray(list) ? list : []) {
			if (clearEntry(entry)) changed = true;
		}
	}
	if (!changed) return false;
	s.updateAggregatedEntries(path);
	return true;
}

export function isFileKnown(indexer: any, path: string): boolean {
	const s = state(indexer);
	return Boolean(s.files[path]);
}

export function setFileMarkColor(indexer: any, path: string, markColor: number | null): boolean {
	const s = state(indexer);
	const data: any = s.files[path];
	if (!data) return false;
	const desired = normalizeMarkColor(markColor);
	const prev = getFileMarkColor(indexer, path);
	if ((prev == null) === (desired == null) && (prev == null || prev === desired)) {
		return false;
	}
	if (desired == null) {
		delete data.markColor;
	} else {
		data.markColor = desired;
	}
	applyHighlightState(data);
	s.updateAggregatedEntries(path);
	return true;
}

export function isFilePinned(indexer: any, path: string): boolean {
	const s = state(indexer);
	return s.files[path]?.pinnedFile === true;
}

export function setFilePinned(indexer: any, path: string, pinned: boolean): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) {
		return false;
	}
	const desired = pinned === true;
	if ((data.pinnedFile === true) === desired) {
		return false;
	}
	data.pinnedFile = desired;
	s.updateAggregatedEntries(path);
	return true;
}

export function setEntryPinned(indexer: any, target: DateEntry, pinned: boolean): boolean {
	if (!target) return false;
	const changed = setFilePinned(indexer, target.file, pinned);
	if (changed) {
		target.pinned = pinned === true;
	}
	return changed;
}

export function getIndexedPaths(indexer: any): string[] {
	const s = state(indexer);
	return Object.keys(s.files);
}

export function getFileIndexData(indexer: any, path: string): FileIndexData | null {
	const s = state(indexer);
	return s.files[path] ?? null;
}

export function getFileEmbeddingTerm(indexer: any, path: string): string {
	const s = state(indexer);
	const data: any = s.files[path];
	if (!data) return "";
	return typeof data.embeddingTerm === "string" ? data.embeddingTerm.trim() : "";
}

export function setFileEmbeddingTerm(indexer: any, path: string, term: string): boolean {
	const s = state(indexer);
	const normalizedPath = String(path || "");
	const normalized = String(term ?? "").trim();
	let data: any = s.files[normalizedPath];
	if (!data) {
		data = {
			cdate: null,
			namedDate: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null
		} as any;
		s.files[normalizedPath] = data;
	}
	const prev = typeof data.embeddingTerm === "string" ? data.embeddingTerm.trim() : "";
	if (prev === normalized) return false;
	if (!normalized) {
		delete data.embeddingTerm;
	} else {
		data.embeddingTerm = normalized;
	}
	try {
		const anyPlugin: any = s.plugin as any;
		anyPlugin.termSimilarityStoreRev = (typeof anyPlugin.termSimilarityStoreRev === "number" ? anyPlugin.termSimilarityStoreRev : 0) + 1;
	} catch {
		// ignore
	}
	try {
		s.updateAggregatedEntries(normalizedPath);
	} catch {
		// ignore
	}
	return true;
}
