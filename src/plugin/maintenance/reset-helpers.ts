import type { EpochPlugin } from "../../main";

type ResetEntryRuntime = {
	aiSummary?: unknown;
	aiSummaryInputHash?: unknown;
	file?: unknown;
	source?: unknown;
	reviewState?: unknown;
};

type ResetFileRuntime = {
	cdate?: ResetEntryRuntime;
	namedDate?: ResetEntryRuntime;
	contentDates?: unknown;
	trackedDates?: unknown;
	trackedSnapshot?: unknown;
	trackedSnapshotDate?: unknown;
	trackedBaselineSnapshot?: unknown;
	trackedBaselineDate?: unknown;
};

type ResetIndexerRuntime = {
	getIndexedPaths?: () => unknown;
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
	const paths = getIndexedPaths(indexer);
	let changedCount = 0;
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
					if (entry.reviewState === "hidden") continue;
					if (entry.reviewState !== "reviewed") {
						entry.reviewState = "reviewed";
						if (typeof entry.file === "string" && entry.file) changedFiles.add(entry.file);
					}
				}
			}
			changedCount = changedFiles.size;
		}
	}
	return changedCount;
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
