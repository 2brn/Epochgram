import type { EpochPlugin } from "../../main";

type ResetEntryRuntime = {
	aiSummary?: unknown;
	aiSummaryInputHash?: unknown;
	file?: unknown;
	source?: unknown;
	date?: unknown;
	originalDate?: unknown;
	blockStart?: unknown;
	blockEnd?: unknown;
	trackedChange?: unknown;
	trackedHash?: unknown;
	reviewState?: unknown;
};

type ResetFileRuntime = {
	cdate?: ResetEntryRuntime;
	namedDate?: ResetEntryRuntime;
	dateProp?: ResetEntryRuntime;
	contentDates?: unknown;
	trackedDates?: unknown;
	recurHiddenDates?: unknown;
	recurReviewedDates?: unknown;
	trackedSnapshot?: unknown;
	trackedSnapshotDate?: unknown;
	trackedBaselineSnapshot?: unknown;
	trackedBaselineDate?: unknown;
};

type ResetIndexerRuntime = {
	getIndexedPaths?: () => unknown;
	refreshSyntheticEntries?: () => void;
	files?: Record<string, ResetFileRuntime>;
	index?: Record<string, ResetEntryRuntime[]>;
	getFileMarkColor?: (path: string) => number | null;
	setFileMarkColor?: (path: string, color: number | null) => boolean;
	getFileEmbeddingTerm?: (path: string) => unknown;
	setFileEmbeddingTerm?: (path: string, term: string) => boolean;
	clearFileReviewOverrides?: (path: string) => boolean;
	setFileReviewStateForAllRecordsPreserveHidden?: (path: string, state: string) => boolean;
	setFileReviewStateForAllRecords?: (path: string, state: string) => boolean;
	isFilePinned?: (path: string) => boolean;
	setFilePinned?: (path: string, pinned: boolean) => boolean;
	updateAggregatedEntries?: (path: string) => void;
};

type ResetPluginRuntime = {
	termSimilarityResetKey?: number;
	__epochTopicClassificationSweepTimer?: number | null;
	termSimilarityQueueTimer?: number | null;
	termSimilarityEnsureTimer?: number | null;
	termSimilarityQueueRunning?: boolean;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	termSimilarityProcessingStartedAt?: number;
	termSimilarityStartedAt?: number;
	termSimilarityStoreCache?: unknown;
	termSimilarityStoreDirtyUpdates?: number;
	termSimilarityStoreLastWriteAt?: number;
	similarityResetKey?: number;
	similarityQueueTimer?: number | null;
	similarityQueueRunning?: boolean;
	similarityPendingFiles?: Set<string>;
	similarityQueueTotal?: number;
	similarityQueueProcessed?: number;
	similarityVectorUpdateProcessingStartedAt?: number;
	similarityVectorUpdateStartedAt?: number;
	similarityStoreCache?: unknown;
	similarityStoreDirtyUpdates?: number;
	similarityStoreLastWriteAt?: number;
};

function getResetIndexer(plugin: EpochPlugin): ResetIndexerRuntime {
	return plugin.indexer as unknown as ResetIndexerRuntime;
}

function getIndexedPaths(indexer: ResetIndexerRuntime): string[] {
	try {
		const indexed = indexer.getIndexedPaths?.();
		if (Array.isArray(indexed)) return indexed.filter((p): p is string => typeof p === "string");
	} catch {
		// ignore
	}
	const files = indexer.files ?? {};
	return Object.keys(files);
}

function reviewCarryKey(entry: ResetEntryRuntime | null | undefined): string {
	if (!entry) return "";
	const date = typeof entry.date === "string" ? entry.date : "";
	const originalDate = typeof entry.originalDate === "string" ? entry.originalDate : "";
	const effectiveDate = originalDate || date;
	const source = typeof entry.source === "string" ? entry.source : "";
	const blockStart = Number(entry.blockStart);
	const blockEnd = Number(entry.blockEnd);
	const parts = [
		source,
		effectiveDate,
		Number.isFinite(blockStart) ? String(blockStart) : "",
		Number.isFinite(blockEnd) ? String(blockEnd) : ""
	];
	if (source === "tracked") {
		parts.push(
			typeof entry.trackedChange === "string" ? entry.trackedChange : "",
			typeof entry.trackedHash === "string" ? entry.trackedHash : ""
		);
	}
	return parts.join("|");
}

function collectReviewedIndexKeysByPath(indexer: ResetIndexerRuntime): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const idx = indexer.index;
	if (!idx || typeof idx !== "object") return out;
	for (const list of Object.values(idx)) {
		if (!Array.isArray(list)) continue;
		for (const entry of list) {
			if (!entry || typeof entry !== "object") continue;
			if (entry.reviewState !== "reviewed") continue;
			const path = typeof entry.file === "string" ? entry.file : "";
			if (!path) continue;
			const key = reviewCarryKey(entry);
			if (!key) continue;
			let set = out.get(path);
			if (!set) {
				set = new Set<string>();
				out.set(path, set);
			}
			set.add(key);
		}
	}
	return out;
}

function reapplyReviewedKeysToFileData(indexer: ResetIndexerRuntime, reviewedByPath: Map<string, Set<string>>): number {
	let changedFiles = 0;
	for (const [path, keys] of reviewedByPath.entries()) {
		if (!keys || keys.size === 0) continue;
		const data = indexer.files?.[path];
		if (!data) continue;
		const entries: ResetEntryRuntime[] = [];
		if (data.cdate && typeof data.cdate === "object") entries.push(data.cdate);
		if (data.namedDate && typeof data.namedDate === "object") entries.push(data.namedDate);
		if ((data as { dateProp?: unknown }).dateProp && typeof (data as { dateProp?: unknown }).dateProp === "object") {
			entries.push((data as { dateProp?: ResetEntryRuntime }).dateProp as ResetEntryRuntime);
		}
		if (Array.isArray(data.contentDates)) {
			for (const item of data.contentDates) {
				if (item && typeof item === "object") entries.push(item as ResetEntryRuntime);
			}
		}
		const tracked = data.trackedDates;
		if (tracked && typeof tracked === "object") {
			for (const list of Object.values(tracked as Record<string, unknown>)) {
				if (!Array.isArray(list)) continue;
				for (const item of list) {
					if (item && typeof item === "object") entries.push(item as ResetEntryRuntime);
				}
			}
		}
		let changed = false;
		for (const entry of entries) {
			if (entry.reviewState === "hidden" || entry.reviewState === "reviewed") continue;
			const key = reviewCarryKey(entry);
			if (!key || !keys.has(key)) continue;
			entry.reviewState = "reviewed";
			changed = true;
		}
		if (!changed) continue;
		changedFiles++;
		try {
			indexer.updateAggregatedEntries?.(path);
		} catch {
			// ignore
		}
	}
	return changedFiles;
}

function collectRecurringReviewedDatesByPath(indexer: ResetIndexerRuntime): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const idx = indexer.index;
	if (!idx || typeof idx !== "object") return out;
	for (const list of Object.values(idx)) {
		if (!Array.isArray(list)) continue;
		for (const entry of list) {
			if (!entry || typeof entry !== "object") continue;
			if ((entry as { recurring?: unknown }).recurring !== true) continue;
			if (entry.reviewState !== "reviewed") continue;
			const path = typeof entry.file === "string" ? entry.file : "";
			const key = typeof entry.date === "string" ? entry.date.trim() : "";
			if (!path || !/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
			let set = out.get(path);
			if (!set) {
				set = new Set<string>();
				out.set(path, set);
			}
			set.add(key);
		}
	}
	return out;
}

function reapplyRecurringReviewedDates(indexer: ResetIndexerRuntime, recurringReviewedByPath: Map<string, Set<string>>): number {
	let changedFiles = 0;
	for (const [path, reviewedSet] of recurringReviewedByPath.entries()) {
		const data = indexer.files?.[path];
		if (!data) continue;
		const hidden = Array.isArray(data.recurHiddenDates)
			? new Set(data.recurHiddenDates.map(v => String(v || "").trim()).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)))
			: new Set<string>();
		const next = Array.from(reviewedSet).filter(v => !hidden.has(v)).sort((a, b) => a.localeCompare(b));
		const prev = Array.isArray(data.recurReviewedDates)
			? data.recurReviewedDates.map(v => String(v || "").trim()).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)).sort((a, b) => a.localeCompare(b))
			: [];
		if (next.length === prev.length && next.every((v, i) => v === prev[i])) continue;
		data.recurReviewedDates = next;
		changedFiles++;
		try {
			indexer.updateAggregatedEntries?.(path);
		} catch {
			// ignore
		}
	}
	return changedFiles;
}

function collectReviewStates(indexer: ResetIndexerRuntime): Map<string, unknown> {
	const states = new Map<string, unknown>();
	const add = (entry: ResetEntryRuntime, path: string, key: string): void => {
		if (entry.reviewState === "hidden") return;
		states.set(`${path}|${key}`, entry.reviewState);
	};
	for (const [path, data] of Object.entries(indexer.files ?? {})) {
		const entries: ResetEntryRuntime[] = [];
		if (data.cdate) entries.push(data.cdate);
		if (data.namedDate) entries.push(data.namedDate);
		if (data.dateProp) entries.push(data.dateProp);
		if (Array.isArray(data.contentDates)) entries.push(...data.contentDates.filter((entry): entry is ResetEntryRuntime => !!entry && typeof entry === "object"));
		if (data.trackedDates && typeof data.trackedDates === "object") {
			for (const entriesByDate of Object.values(data.trackedDates as Record<string, unknown>)) {
				if (Array.isArray(entriesByDate)) entries.push(...entriesByDate.filter((entry): entry is ResetEntryRuntime => !!entry && typeof entry === "object"));
			}
		}
		for (const entry of entries) add(entry, path, reviewCarryKey(entry));
	}
	for (const [date, entries] of Object.entries(indexer.index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const [position, entry] of entries.entries()) {
			if (!entry || typeof entry !== "object") continue;
			const path = typeof entry.file === "string" && entry.file ? entry.file : `index-only:${date}:${position}`;
			const recurring = (entry as { recurring?: unknown }).recurring === true;
			const entryDate = typeof entry.date === "string" ? entry.date : date;
			const key = recurring ? `recurring:${entryDate}` : reviewCarryKey(entry);
			add(entry, path, key);
		}
	}
	return states;
}

function countNewlyReviewedRecords(before: Map<string, unknown>, indexer: ResetIndexerRuntime): number {
	const after = collectReviewStates(indexer);
	let changed = 0;
	for (const [key, reviewState] of before) {
		if (reviewState !== "reviewed" && after.get(key) === "reviewed") changed++;
	}
	return changed;
}

export function clearAllMarks(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const paths = getIndexedPaths(indexer);
	let cleared = 0;
	for (const p of paths) {
		try {
			const current = indexer.getFileMarkColor?.(p) ?? null;
			if (current == null) continue;
			const changed = indexer.setFileMarkColor?.(p, null) === true;
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function clearAllEmbeddingTerms(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const paths = getIndexedPaths(indexer);
	let cleared = 0;
	for (const p of paths) {
		try {
			const raw = indexer.getFileEmbeddingTerm?.(p);
			const prev = typeof raw === "string" ? raw.trim() : "";
			if (!prev) continue;
			const changed = indexer.setFileEmbeddingTerm?.(p, "") === true;
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function resetAllReviewStates(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const paths = getIndexedPaths(indexer);
	let changedCount = 0;
	for (const p of paths) {
		try {
			const changed = indexer.clearFileReviewOverrides?.(p) === true;
			if (changed) changedCount++;
		} catch {
			// ignore
		}
	}
	if (changedCount === 0) {
		const idx = indexer.index;
		if (idx && typeof idx === "object") {
			const changedFiles = new Set<string>();
			for (const list of Object.values(idx)) {
				if (!Array.isArray(list)) continue;
				for (const entry of list) {
					if (!entry || typeof entry !== "object") continue;
					if (entry.reviewState === "reviewed") {
						entry.reviewState = "draft";
						if (typeof entry.file === "string" && entry.file) changedFiles.add(entry.file);
					}
				}
			}
			changedCount = changedFiles.size;
		}
	}
	return changedCount;
}

export function reviewAllDraftFiles(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	try {
		indexer.refreshSyntheticEntries?.();
	} catch {
		// ignore
	}
	const reviewStatesBefore = collectReviewStates(indexer);
	const pathSet = new Set<string>(getIndexedPaths(indexer));
	const idx = indexer.index;
	if (idx && typeof idx === "object") {
		for (const list of Object.values(idx)) {
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				if (!entry || typeof entry !== "object") continue;
				if (typeof entry.file === "string" && entry.file) pathSet.add(entry.file);
			}
		}
	}
	const paths = Array.from(pathSet);
	const changedFiles = new Set<string>();
	for (const p of paths) {
		try {
			const preserveFn = indexer.setFileReviewStateForAllRecordsPreserveHidden;
			const preserveChanged = typeof preserveFn === "function"
				? preserveFn(p, "reviewed") === true
				: false;
			const standardChanged = indexer.setFileReviewStateForAllRecords?.(p, "reviewed") === true;
			let fallbackChanged = false;
			const data = indexer.files?.[p];
			if (data) {
				const entries: ResetEntryRuntime[] = [];
				if (data.cdate) entries.push(data.cdate);
				if (data.namedDate) entries.push(data.namedDate);
				if (Array.isArray(data.contentDates)) {
					for (const item of data.contentDates) {
						if (item && typeof item === "object") entries.push(item as ResetEntryRuntime);
					}
				}
				const tracked = data.trackedDates;
				if (tracked && typeof tracked === "object") {
					for (const list of Object.values(tracked as Record<string, unknown>)) {
						if (!Array.isArray(list)) continue;
						for (const item of list) {
							if (item && typeof item === "object") entries.push(item as ResetEntryRuntime);
						}
					}
				}
				for (const entry of entries) {
					if (entry.reviewState === "hidden") continue;
					if (entry.reviewState !== "reviewed") {
						entry.reviewState = "reviewed";
						fallbackChanged = true;
					}
				}
				if (fallbackChanged) {
					indexer.updateAggregatedEntries?.(p);
				}
			}
			const changed = preserveChanged || standardChanged || fallbackChanged;
			if (changed) changedFiles.add(p);
		} catch {
			// ignore
		}
	}
	const liveIndex = indexer.index;
	if (liveIndex && typeof liveIndex === "object") {
		for (const list of Object.values(liveIndex)) {
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				if (!entry || typeof entry !== "object") continue;
				if (entry.reviewState === "hidden") continue;
				if (entry.reviewState === "reviewed") continue;
				entry.reviewState = "reviewed";
				if (typeof entry.file === "string" && entry.file) changedFiles.add(entry.file);
			}
		}
	}
	const reviewedByPath = collectReviewedIndexKeysByPath(indexer);
	const rehydratedFiles = reapplyReviewedKeysToFileData(indexer, reviewedByPath);
	const recurringReviewedByPath = collectRecurringReviewedDatesByPath(indexer);
	const recurringRehydratedFiles = reapplyRecurringReviewedDates(indexer, recurringReviewedByPath);
	for (const p of Array.from(reviewedByPath.keys())) {
		changedFiles.add(p);
	}
	for (const p of Array.from(recurringReviewedByPath.keys())) {
		changedFiles.add(p);
	}
	if (rehydratedFiles > 0) {
		for (const p of Array.from(reviewedByPath.keys())) {
			if (indexer.files?.[p]) changedFiles.add(p);
		}
	}
	if (recurringRehydratedFiles > 0) {
		for (const p of Array.from(recurringReviewedByPath.keys())) {
			if (indexer.files?.[p]) changedFiles.add(p);
		}
	}
	return countNewlyReviewedRecords(reviewStatesBefore, indexer);
}

export function clearAllPins(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const paths = getIndexedPaths(indexer);
	let cleared = 0;
	for (const p of paths) {
		try {
			const pinned = indexer.isFilePinned?.(p) === true;
			if (!pinned) continue;
			const changed = indexer.setFilePinned?.(p, false) === true;
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function clearTopicRuntimeState(plugin: EpochPlugin): void {
	const runtime = plugin as unknown as ResetPluginRuntime;
	try {
		runtime.termSimilarityResetKey = (typeof runtime.termSimilarityResetKey === "number" ? runtime.termSimilarityResetKey : 0) + 1;
	} catch {
		// ignore
	}
	try {
		const t = runtime.__epochTopicClassificationSweepTimer;
		if (typeof t === "number") window.clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		runtime.__epochTopicClassificationSweepTimer = null;
	} catch {
		// ignore
	}
	try {
		const t = runtime.termSimilarityQueueTimer;
		if (typeof t === "number") window.clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		const t = runtime.termSimilarityEnsureTimer;
		if (typeof t === "number") window.clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		runtime.termSimilarityQueueTimer = null;
		runtime.termSimilarityEnsureTimer = null;
		runtime.termSimilarityQueueRunning = false;
		runtime.termSimilarityPendingFiles = new Set<string>();
		runtime.termSimilarityQueueTotal = 0;
		runtime.termSimilarityQueueProcessed = 0;
		runtime.termSimilarityProcessingStartedAt = 0;
		runtime.termSimilarityStartedAt = 0;
	} catch {
		// ignore
	}
	try {
		runtime.termSimilarityStoreCache = null;
		runtime.termSimilarityStoreDirtyUpdates = 0;
		runtime.termSimilarityStoreLastWriteAt = 0;
	} catch {
		// ignore
	}
}

export function clearSemanticRuntimeState(plugin: EpochPlugin): void {
	const runtime = plugin as unknown as ResetPluginRuntime;
	try {
		runtime.similarityResetKey = (typeof runtime.similarityResetKey === "number" ? runtime.similarityResetKey : 0) + 1;
	} catch {
		// ignore
	}
	try {
		const t = runtime.similarityQueueTimer;
		if (typeof t === "number") window.clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		runtime.similarityQueueTimer = null;
		runtime.similarityQueueRunning = false;
		runtime.similarityPendingFiles = new Set<string>();
		runtime.similarityQueueTotal = 0;
		runtime.similarityQueueProcessed = 0;
		runtime.similarityVectorUpdateProcessingStartedAt = 0;
		runtime.similarityVectorUpdateStartedAt = 0;
	} catch {
		// ignore
	}
	try {
		runtime.similarityStoreCache = null;
		runtime.similarityStoreDirtyUpdates = 0;
		runtime.similarityStoreLastWriteAt = 0;
	} catch {
		// ignore
	}
}

export function clearAllAiSummaries(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const files = indexer.files ?? {};
	const index = indexer.index ?? {};
	let cleared = 0;
	const clearEntry = (e: ResetEntryRuntime | undefined): boolean => {
		if (!e) return false;
		const s = typeof e.aiSummary === "string" ? e.aiSummary.trim() : "";
		const h = typeof e.aiSummaryInputHash === "string" ? e.aiSummaryInputHash.trim() : "";
		if (!s && !h) return false;
		try {
			delete e.aiSummary;
			delete e.aiSummaryInputHash;
		} catch {
			// ignore
		}
		cleared++;
		return true;
	};
	for (const [path, data] of Object.entries(files)) {
		let changed = false;
		try {
			if (clearEntry(data.cdate)) changed = true;
			if (clearEntry(data.namedDate)) changed = true;
			for (const e of Array.isArray(data.contentDates) ? data.contentDates : []) {
				if (typeof e === "object" && e !== null && clearEntry(e as ResetEntryRuntime)) changed = true;
			}
			const tracked = data.trackedDates;
			const trackedByDate = (typeof tracked === "object" && tracked !== null) ? tracked as Record<string, unknown> : {};
			for (const list of Object.values(trackedByDate)) {
				for (const e of Array.isArray(list) ? list : []) {
					if (typeof e === "object" && e !== null && clearEntry(e as ResetEntryRuntime)) changed = true;
				}
			}
		} catch {
			// ignore
		}
		if (changed) {
			try {
				indexer.updateAggregatedEntries?.(path);
			} catch {
				// ignore
			}
		}
	}

	try {
		for (const entries of Object.values(index)) {
			if (!Array.isArray(entries)) continue;
			for (const e of entries) {
				const file = typeof e?.file === "string" ? e.file : "";
				const isEpoch = file.startsWith("epoch://");
				if (isEpoch) continue;
				clearEntry(e);
			}
		}
	} catch {
		// ignore
	}
	return cleared;
}

export function hardResetTrackedState(plugin: EpochPlugin): boolean {
	const indexer = getResetIndexer(plugin);
	const files = indexer.files ?? {};
	const index = indexer.index ?? {};
	let changed = false;

	for (const [path, data] of Object.entries(files)) {
		let fileChanged = false;
		try {
			const tracked = data.trackedDates;
			if (tracked && typeof tracked === "object" && Object.keys(tracked).length > 0) {
				data.trackedDates = {};
				fileChanged = true;
			}
			if (data.trackedSnapshot != null) {
				data.trackedSnapshot = null;
				fileChanged = true;
			}
			if (data.trackedSnapshotDate != null) {
				data.trackedSnapshotDate = null;
				fileChanged = true;
			}
			if (data.trackedBaselineSnapshot != null) {
				data.trackedBaselineSnapshot = null;
				fileChanged = true;
			}
			if (data.trackedBaselineDate != null) {
				data.trackedBaselineDate = null;
				fileChanged = true;
			}
		} catch {
			// ignore
		}
		if (fileChanged) {
			changed = true;
			try {
				indexer.updateAggregatedEntries?.(path);
			} catch {
				// ignore
			}
		}
	}

	try {
		for (const [date, entries] of Object.entries(index)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const kept = entries.filter((e) => e?.source !== "tracked");
			if (kept.length === entries.length) continue;
			changed = true;
			if (kept.length > 0) {
				index[date] = kept;
			} else {
				delete index[date];
			}
		}
	} catch {
		// ignore
	}

	return changed;
}

export function clearEpochEntries(plugin: EpochPlugin): number {
	const indexer = getResetIndexer(plugin);
	const index = indexer.index ?? {};
	let removed = 0;
	for (const [date, entries] of Object.entries(index)) {
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const kept = entries.filter((e) => {
			const file = typeof e?.file === "string" ? e.file : "";
			const isEpoch = file.startsWith("epoch://");
			if (isEpoch) removed++;
			return !isEpoch;
		});
		index[date] = kept;
	}
	return removed;
}
