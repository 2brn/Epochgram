import { TFile } from "obsidian";
import { MAX_MARK_COLORS } from "../ui/mark-colors";
import { getEpochMarkColorSet } from "../ui/mark-colors";
import type { DateEntry, FileIndexData, FileReviewState } from "./types";
import { expandRecurrenceToDateKeys } from "./recurrence";
import {
	applyHighlightState,
	entryEffectiveDate,
	entrySignature,
	gatherFileEntries,
	trackedEntryKey
} from "./entry-state";
import { setYamlPropertyForFile } from "../plugin/note-frontmatter";

interface EntryUpdatesState {
	files: Record<string, FileIndexData>;
	index?: Record<string, DateEntry[]>;
	plugin: unknown;
	updateAggregatedEntries(filePath: string, options?: { skipSort?: boolean }): void;
}

type EntryUpdatesPluginRuntime = {
	termSimilarityStoreRev?: number;
};

function state(indexer: unknown): EntryUpdatesState {
	return indexer as EntryUpdatesState;
}

function getFileForPath(indexer: EntryUpdatesState, path: string): TFile | null {
	try {
		const plugin = indexer.plugin as { app?: { vault?: { getAbstractFileByPath?: (filePath: string) => unknown } } };
		const file = plugin.app?.vault?.getAbstractFileByPath?.(path);
		return file instanceof TFile ? file : null;
	} catch {
		return null;
	}
}

function normalizeMarkColor(markColor: number | null): number | null {
	if (typeof markColor !== "number" || !Number.isFinite(markColor) || markColor <= 0) {
		return null;
	}
	return Math.max(1, Math.min(MAX_MARK_COLORS, Math.floor(markColor)));
}

function normalizeMarkHex(markColor: unknown): string {
	const value = String(markColor ?? "").trim();
	if (!value) return "";
	const hex = value.startsWith("#") ? value : `#${value}`;
	if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return "";
	return hex.toLowerCase();
}

function normalizeFileReviewState(value: unknown): FileReviewState {
	if (typeof value !== "string") return "draft";
	const s = value.trim().toLowerCase();
	if (s === "reviewed") return "reviewed";
	if (s === "draft") return "draft";
	return "draft";
}

function isDateKey(value: unknown): boolean {
	if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
	if (typeof value === "number") return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
	return false;
}

function gatherEntriesSafe(data: FileIndexData): DateEntry[] {
	const out: DateEntry[] = [];
	if (data.cdate) out.push(data.cdate);
	if (data.namedDate) out.push(data.namedDate);
	if (data.dateProp) out.push(data.dateProp);
	if (Array.isArray(data.contentDates)) out.push(...data.contentDates);
	if (data.trackedDates && typeof data.trackedDates === "object") {
		for (const value of Object.values(data.trackedDates)) {
			if (Array.isArray(value)) out.push(...value);
		}
	}
	return out;
}

function normalizeDateKeys(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const out = new Set<string>();
	for (const value of values) {
		const key = String(value || "").trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.add(key);
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function sameDateKeys(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function todayDateKey(): string {
	const d = new Date();
	const y = String(d.getFullYear());
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function collectRecurringDateKeysFromData(data: FileIndexData): string[] {
	const rec = data.recur;
	if (!rec || typeof rec !== "object") return [];
	const anchorRaw = data.namedDate?.date || data.dateProp?.date || data.cdate?.date || null;
	const anchorKey = typeof anchorRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw)
		? anchorRaw
		: null;
	const keys = expandRecurrenceToDateKeys({
		recur: rec,
		fallbackFromKey: anchorKey,
		todayKey: todayDateKey()
	});
	const out = new Set<string>();
	for (const key of keys) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.add(key);
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function collectRecurringDateKeysForFile(s: EntryUpdatesState, path: string): string[] {
	const out = new Set<string>();
	const index = s.index;
	if (index && typeof index === "object") {
		for (const list of Object.values(index)) {
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				if (!entry || typeof entry !== "object") continue;
				if (entry.file !== path) continue;
				if (entry.recurring !== true) continue;
				const key = String(entry.date || "").trim();
				if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.add(key);
			}
		}
	}
	const data = s.files[path];
	if (data) {
		for (const key of collectRecurringDateKeysFromData(data)) {
			out.add(key);
		}
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function setEntryReviewState(indexer: unknown, target: DateEntry, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data = s.files[target.file];
	if (!data) return false;

	const dayKey = String(target.date || "").trim();
	if (!isDateKey(dayKey)) return false;
	const desired = normalizeFileReviewState(reviewState);
	let changed = false;

	const entries = gatherEntriesSafe(data);
	const related = (() => {
		const canGroupByDay = target.recurring !== true;
		const matches = canGroupByDay ? entries.filter((e) => String(e.date || "") === dayKey) : [];
		const fallbackMatches = (() => {
			const keyFor = (e: DateEntry): string => (e.source === "tracked" ? trackedEntryKey(e) : entrySignature(e));
			const targetKey = keyFor(target);
			if (!targetKey) return [] as DateEntry[];
			return entries.filter((e) => keyFor(e) === targetKey);
		})();
		return matches.length > 0 ? matches : fallbackMatches;
	})();

	if (related.length === 0) {
		try {
			if (data.recur) {
				const listRaw = data.recurReviewedDates;
				const list = Array.isArray(listRaw) ? listRaw.map((v) => String(v || "").trim()).filter(Boolean) : [];
				const set = new Set<string>(list.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)));
				const had = set.has(dayKey);
				if (desired === "reviewed") set.add(dayKey);
				else set.delete(dayKey);
				const changedRecurReviewed = desired === "reviewed" ? !had : had;
				if (changedRecurReviewed) {
					data.recurReviewedDates = Array.from(set).sort((a, b) => a.localeCompare(b));
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		try {
			const raw = data.recurHiddenDates;
			if (Array.isArray(raw) && raw.length > 0) {
				const next = raw.map((v) => String(v || "").trim()).filter(Boolean).filter((k) => k !== dayKey);
				if (next.length !== raw.length) {
					data.recurHiddenDates = next;
					changed = true;
				}
			}
		} catch {
			// ignore
		}
		try {
			if (desired === "reviewed") target.reviewState = "reviewed";
			else if (target.reviewState != null) delete target.reviewState;
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
				if (entry.reviewState != null) {
					delete entry.reviewState;
					changed = true;
				}
			} else if (entry.reviewState !== "reviewed") {
				entry.reviewState = "reviewed";
				changed = true;
			}
		} catch {
			// ignore
		}
	}

	try {
		if (desired === "reviewed") target.reviewState = "reviewed";
		else if (target.reviewState != null) delete target.reviewState;
	} catch {
		// ignore
	}

	if (!changed) return false;
	s.updateAggregatedEntries(target.file);
	return true;
}

export function setEntryHidden(indexer: unknown, target: DateEntry, hidden: boolean): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data = s.files[target.file];
	if (!data) return false;

	const dayKey = String(target.date || "").trim();
	const isValidDateKey = /^\d{4}-\d{2}-\d{2}$/.test(dayKey);
	const updateRecurringHidden = (): boolean => {
		try {
			if (!data.recur) return false;
			if (!isValidDateKey) return false;
			const listRaw = data.recurHiddenDates;
			const list = Array.isArray(listRaw) ? listRaw.map((v) => String(v || "").trim()).filter(Boolean) : [];
			const set = new Set<string>(list.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)));
			const had = set.has(dayKey);
			if (hidden) set.add(dayKey);
			else set.delete(dayKey);
			const changed = hidden ? !had : had;
			if (!changed) return false;
			data.recurHiddenDates = Array.from(set).sort((a, b) => a.localeCompare(b));
			return true;
		} catch {
			return false;
		}
	};

	const entries = gatherFileEntries(data);
	if (entries.length === 0) return false;

	const matches = dayKey ? entries.filter((e) => String(e.date || "") === dayKey) : [];
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
		target.reviewState = hidden ? "hidden" : undefined;
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
		} else if (entry.reviewState === "hidden") {
			delete entry.reviewState;
			changed = true;
		}
	}
	const changedRecurring = updateRecurringHidden();
	if (changedRecurring) changed = true;
	if (!changed) return false;

	target.reviewState = hidden ? "hidden" : undefined;
	s.updateAggregatedEntries(target.file);
	return true;
}

export function setFileHidden(indexer: unknown, path: string, hidden: boolean): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data = s.files[p];
	if (!data) return false;

	const entries = gatherEntriesSafe(data);
	const recurringKeys = collectRecurringDateKeysForFile(s, p);
	if (entries.length === 0 && recurringKeys.length === 0) return false;

	const recurringHiddenSet = new Set<string>(normalizeDateKeys(data.recurHiddenDates));
	const entriesHidden = entries.length === 0 || entries.every((e) => e.reviewState === "hidden");
	const recurringHidden = recurringKeys.length === 0 || recurringKeys.every((k) => recurringHiddenSet.has(k));
	const currentlyHidden = entriesHidden && recurringHidden;
	if (hidden === currentlyHidden) return false;

	let changed = false;
	if (hidden) {
		for (const entry of entries) {
			if (entry.reviewState !== "hidden") {
				entry.reviewState = "hidden";
				changed = true;
			}
		}
		const nextHidden = recurringKeys;
		const prevHidden = normalizeDateKeys(data.recurHiddenDates);
		if (!sameDateKeys(prevHidden, nextHidden)) {
			data.recurHiddenDates = nextHidden;
			changed = true;
		}
		const prevReviewed = normalizeDateKeys(data.recurReviewedDates);
		if (prevReviewed.length > 0) {
			data.recurReviewedDates = [];
			changed = true;
		}
	}

	if (!hidden) {
		for (const entry of entries) {
			if (entry.reviewState === "hidden") {
				delete entry.reviewState;
				changed = true;
			}
		}
		for (const entry of entries) {
			if (entry.reviewState === "reviewed") {
				delete entry.reviewState;
				changed = true;
			}
		}
		if (Array.isArray(data.recurHiddenDates) && data.recurHiddenDates.length > 0) {
			data.recurHiddenDates = [];
			changed = true;
		}
		if (Array.isArray(data.recurReviewedDates) && data.recurReviewedDates.length > 0) {
			data.recurReviewedDates = [];
			changed = true;
		}
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function isFileHidden(indexer: unknown, path: string): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data = s.files[p];
	if (!data) return false;
	const entries = gatherEntriesSafe(data);
	const recurringKeys = collectRecurringDateKeysForFile(s, p);
	if (entries.length === 0 && recurringKeys.length === 0) return false;
	const entriesHidden = entries.length === 0 || entries.every((e) => e.reviewState === "hidden");
	const recurringHiddenSet = new Set<string>(normalizeDateKeys(data.recurHiddenDates));
	const recurringHidden = recurringKeys.length === 0 || recurringKeys.every((k) => recurringHiddenSet.has(k));
	return entriesHidden && recurringHidden;
}

export function setFileReviewStateForAllRecords(indexer: unknown, path: string, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data = s.files[p];
	if (!data) return false;

	const entries = gatherEntriesSafe(data);
	const recurringKeys = collectRecurringDateKeysForFile(s, p);
	if (entries.length === 0 && recurringKeys.length === 0) return false;

	const desired = normalizeFileReviewState(reviewState);
	let changed = false;

	for (const entry of entries) {
		if (entry.reviewState === "hidden") {
			delete entry.reviewState;
			changed = true;
		}
	}
	if (Array.isArray(data.recurHiddenDates) && data.recurHiddenDates.length > 0) {
		data.recurHiddenDates = [];
		changed = true;
	}

	for (const entry of entries) {
		if (desired === "draft") {
			if (entry.reviewState === "reviewed") {
				delete entry.reviewState;
				changed = true;
			}
			if (entry.reviewState === "hidden") {
				delete entry.reviewState;
				changed = true;
			}
		} else if (entry.reviewState !== "reviewed") {
			entry.reviewState = "reviewed";
			changed = true;
		}
	}
	if (desired === "draft") {
		if (Array.isArray(data.recurReviewedDates) && data.recurReviewedDates.length > 0) {
			data.recurReviewedDates = [];
			changed = true;
		}
	} else {
		const nextReviewed = recurringKeys;
		const prevReviewed = normalizeDateKeys(data.recurReviewedDates);
		if (!sameDateKeys(prevReviewed, nextReviewed)) {
			data.recurReviewedDates = nextReviewed;
			changed = true;
		}
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function setFileReviewStateForAllRecordsPreserveHidden(indexer: unknown, path: string, reviewState: FileReviewState): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data = s.files[p];
	if (!data) return false;

	const entries = gatherEntriesSafe(data);
	const recurringKeys = collectRecurringDateKeysForFile(s, p);
	if (entries.length === 0 && recurringKeys.length === 0) return false;

	const desired = normalizeFileReviewState(reviewState);
	let changed = false;
	for (const entry of entries) {
		if (entry.reviewState === "hidden") continue;
		if (desired === "draft") {
			if (entry.reviewState === "reviewed") {
				delete entry.reviewState;
				changed = true;
			}
		} else if (entry.reviewState !== "reviewed") {
			entry.reviewState = "reviewed";
			changed = true;
		}
	}

	if (desired === "draft") {
		if (Array.isArray(data.recurReviewedDates) && data.recurReviewedDates.length > 0) {
			data.recurReviewedDates = [];
			changed = true;
		}
	} else {
		const hiddenSet = new Set<string>(normalizeDateKeys(data.recurHiddenDates));
		const nextReviewed = recurringKeys.filter((k) => !hiddenSet.has(k));
		const prevReviewed = normalizeDateKeys(data.recurReviewedDates);
		if (!sameDateKeys(prevReviewed, nextReviewed)) {
			data.recurReviewedDates = nextReviewed;
			changed = true;
		}
	}

	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function clearFileReviewOverrides(indexer: unknown, path: string): boolean {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return false;
	const data = s.files[p];
	if (!data) return false;
	const entries = gatherEntriesSafe(data);
	let changed = false;
	for (const entry of entries) {
		if (entry.reviewState === "reviewed") {
			delete entry.reviewState;
			changed = true;
		}
	}
	if (Array.isArray(data.recurReviewedDates) && data.recurReviewedDates.length > 0) {
		data.recurReviewedDates = [];
		changed = true;
	}
	if (!changed) return false;
	s.updateAggregatedEntries(p);
	return true;
}

export function toggleFileVisibility(indexer: unknown, path: string): "hidden" | "visible" | null {
	const s = state(indexer);
	const p = String(path || "");
	if (!p) return null;
	const data = s.files[p];
	if (!data) return null;

	const entries = gatherEntriesSafe(data);
	if (entries.length === 0) return null;

	const currentlyHidden = entries.every((e) => e.reviewState === "hidden");
	const changed = setFileHidden(indexer, p, !currentlyHidden);
	if (!changed) return null;
	return !currentlyHidden ? "hidden" : "visible";
}

export function getFileMarkHex(indexer: unknown, path: string): string {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return "";
	return normalizeMarkHex(data.markColorHex);
}

export function getFileMarkColor(indexer: unknown, path: string): number | null {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return null;
	return typeof data.markColor === "number" ? data.markColor : null;
}

export function cycleFileMarkColor(indexer: unknown, path: string): boolean {
	const current = getFileMarkColor(indexer, path);
	const next = current == null ? 1 : ((Math.floor(current) % MAX_MARK_COLORS) + 1);
	return setFileMarkColor(indexer, path, next);
}

export function clearEntryAiSummary(indexer: unknown, target: DateEntry): boolean {
	const s = state(indexer);
	if (!target) return false;
	const data = s.files[target.file];
	if (!data) return false;

	const entries = gatherFileEntries(data);
	if (entries.length === 0) return false;

	const targetDate = entryEffectiveDate(target);
	let related = targetDate
		? entries.filter((entry) => entryEffectiveDate(entry) === targetDate)
		: [];
	if (related.length === 0) {
		const targetSig = entrySignature(target);
		related = entries.filter((entry) => entrySignature(entry) === targetSig);
	}
	if (related.length === 0) return false;

	let changed = false;
	for (const entry of related) {
		const prevS = typeof entry.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const prevH = typeof entry.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		if (!prevS && !prevH) continue;
		delete entry.aiSummary;
		delete entry.aiSummaryInputHash;
		delete entry.aiSummaryVisible;
		changed = true;
	}

	if (!changed) return false;
	delete target.aiSummary;
	delete target.aiSummaryInputHash;
	delete target.aiSummaryVisible;
	s.updateAggregatedEntries(target.file);
	return true;
}

export function clearFileSummaryState(indexer: unknown, path: string): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return false;

	const clearEntry = (entry: DateEntry | null | undefined): boolean => {
		if (!entry) return false;
		const prevAi = typeof entry.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const prevHash = typeof entry.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		if (!prevAi && !prevHash && entry.aiSummaryVisible !== true) return false;
		delete entry.aiSummary;
		delete entry.aiSummaryInputHash;
		delete entry.aiSummaryVisible;
		return true;
	};

	let changed = false;
	if (clearEntry(data.cdate)) changed = true;
	if (clearEntry(data.namedDate)) changed = true;
	if (clearEntry(data.dateProp)) changed = true;
	for (const entry of data.contentDates) {
		if (clearEntry(entry)) changed = true;
	}
	for (const list of Object.values(data.trackedDates)) {
		for (const entry of Array.isArray(list) ? list : []) {
			if (clearEntry(entry)) changed = true;
		}
	}
	if (!changed) return false;
	s.updateAggregatedEntries(path);
	return true;
}

export function isFileKnown(indexer: unknown, path: string): boolean {
	const s = state(indexer);
	return Boolean(s.files[path]);
}

export function setFileMarkColor(indexer: unknown, path: string, markColor: number | string | null): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return false;
	const desiredIndex = normalizeMarkColor(typeof markColor === "number" ? markColor : null);
	const desiredHex = typeof markColor === "string" ? normalizeMarkHex(markColor) : "";
	const prevIndex = getFileMarkColor(indexer, path);
	const prevHex = getFileMarkHex(indexer, path);
	if (prevIndex === desiredIndex && prevHex === desiredHex && ((prevIndex == null) === (desiredIndex == null))) {
		return false;
	}
	if (desiredIndex == null && !desiredHex) {
		delete data.markColor;
		delete data.markColorHex;
		try {
			const file = getFileForPath(s, path);
			if (file) void setYamlPropertyForFile(s.plugin, file, "mark", null);
		} catch {
			// ignore
		}
	} else {
		if (desiredIndex != null) data.markColor = desiredIndex;
		else delete data.markColor;
		const root = (s.plugin as { app?: { workspace?: { containerEl?: HTMLElement } } }).app?.workspace?.containerEl ?? null;
		const palette = getEpochMarkColorSet(root ?? null);
		const hex = desiredHex || (desiredIndex != null ? String(palette[desiredIndex - 1] ?? "").trim().toLowerCase() : "");
		if (hex) data.markColorHex = hex;
		else delete data.markColorHex;
		try {
			const file = getFileForPath(s, path);
			if (file) void setYamlPropertyForFile(s.plugin, file, "mark", hex);
		} catch {
			// ignore
		}
	}
	applyHighlightState(data);
	s.updateAggregatedEntries(path);
	return true;
}

export function isFilePinned(indexer: unknown, path: string): boolean {
	const s = state(indexer);
	return s.files[path]?.pinnedFile === true;
}

export function setFilePinned(indexer: unknown, path: string, pinned: boolean): boolean {
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
	try {
		const file = getFileForPath(s, path);
		if (file) void setYamlPropertyForFile(s.plugin, file, "pin", desired ? true : null);
	} catch {
		// ignore
	}
	s.updateAggregatedEntries(path);
	return true;
}

export function setEntryPinned(indexer: unknown, target: DateEntry, pinned: boolean): boolean {
	if (!target) return false;
	const changed = setFilePinned(indexer, target.file, pinned);
	if (changed) {
		target.pinned = pinned === true;
	}
	return changed;
}

export function getIndexedPaths(indexer: unknown): string[] {
	const s = state(indexer);
	return Object.keys(s.files);
}

export function getFileIndexData(indexer: unknown, path: string): FileIndexData | null {
	const s = state(indexer);
	return s.files[path] ?? null;
}

export function getFileEmbeddingTerm(indexer: unknown, path: string): string {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return "";
	return typeof data.embeddingTerm === "string" ? data.embeddingTerm.trim() : "";
}

export function setFileEmbeddingTerm(indexer: unknown, path: string, term: string): boolean {
	const s = state(indexer);
	const normalizedPath = String(path || "");
	const normalized = String(term ?? "").trim();
	let data = s.files[normalizedPath];
	if (!data) {
		data = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null
		};
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
		const plugin = s.plugin as EntryUpdatesPluginRuntime;
		plugin.termSimilarityStoreRev = (typeof plugin.termSimilarityStoreRev === "number" ? plugin.termSimilarityStoreRev : 0) + 1;
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
