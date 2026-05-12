import type { EpochPlugin } from "../../main";

export function clearAllMarks(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	let paths: string[] = [];
	try {
		const indexed: unknown = indexerAny.getIndexedPaths();
		paths = Array.isArray(indexed) ? indexed : [];
	} catch {
		paths = Object.keys(indexerAny?.files ?? {});
	}
	let cleared = 0;
	for (const p of paths) {
		try {
			const current: number | null = indexerAny.getFileMarkColor(p);
			if (current == null) continue;
			const changed = indexerAny.setFileMarkColor(p, null);
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function clearAllEmbeddingTerms(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	let paths: string[] = [];
	try {
		const indexed: unknown = indexerAny.getIndexedPaths();
		paths = Array.isArray(indexed) ? indexed : [];
	} catch {
		paths = Object.keys(indexerAny?.files ?? {});
	}
	let cleared = 0;
	for (const p of paths) {
		try {
			const prev = String(indexerAny.getFileEmbeddingTerm(p) || "").trim();
			if (!prev) continue;
			const changed = indexerAny.setFileEmbeddingTerm(p, "");
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function resetAllReviewStates(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	let paths: string[] = [];
	try {
		const indexed: unknown = indexerAny.getIndexedPaths();
		paths = Array.isArray(indexed) ? indexed : [];
	} catch {
		paths = Object.keys(indexerAny?.files ?? {});
	}
	let changedCount = 0;
	for (const p of paths) {
		try {
			const changed = indexerAny.clearFileReviewOverrides?.(p) === true;
			if (changed) changedCount++;
		} catch {
			// ignore
		}
	}
	return changedCount;
}

export function reviewAllDraftFiles(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	let paths: string[] = [];
	try {
		const indexed: unknown = indexerAny.getIndexedPaths();
		paths = Array.isArray(indexed) ? indexed : [];
	} catch {
		paths = Object.keys(indexerAny?.files ?? {});
	}
	let changedCount = 0;
	for (const p of paths) {
		try {
			const preserveFn = indexerAny.setFileReviewStateForAllRecordsPreserveHidden;
			const changed = typeof preserveFn === "function"
				? preserveFn.call(indexerAny, p, "reviewed") === true
				: indexerAny.setFileReviewStateForAllRecords?.(p, "reviewed") === true;
			if (changed) changedCount++;
		} catch {
			// ignore
		}
	}
	return changedCount;
}

export function clearAllPins(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	let paths: string[] = [];
	try {
		const indexed: unknown = indexerAny.getIndexedPaths();
		paths = Array.isArray(indexed) ? indexed : [];
	} catch {
		paths = Object.keys(indexerAny?.files ?? {});
	}
	let cleared = 0;
	for (const p of paths) {
		try {
			const pinned = indexerAny.isFilePinned(p);
			if (!pinned) continue;
			const changed = indexerAny.setFilePinned(p, false);
			if (changed) cleared++;
		} catch {
			// ignore
		}
	}
	return cleared;
}

export function clearTopicRuntimeState(plugin: EpochPlugin): void {
	const anyPlugin: any = plugin as any;
	try {
		anyPlugin.termSimilarityResetKey = (typeof anyPlugin.termSimilarityResetKey === "number" ? anyPlugin.termSimilarityResetKey : 0) + 1;
	} catch {
		// ignore
	}
	try {
		const t = anyPlugin?.__epochTopicClassificationSweepTimer;
		if (t != null) clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		anyPlugin.__epochTopicClassificationSweepTimer = null;
	} catch {
		// ignore
	}
	try {
		const t = anyPlugin?.termSimilarityQueueTimer;
		if (t) clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		const t = anyPlugin?.termSimilarityEnsureTimer;
		if (t) clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		anyPlugin.termSimilarityQueueTimer = null;
		anyPlugin.termSimilarityEnsureTimer = null;
		anyPlugin.termSimilarityQueueRunning = false;
		anyPlugin.termSimilarityPendingFiles = new Set<string>();
		anyPlugin.termSimilarityQueueTotal = 0;
		anyPlugin.termSimilarityQueueProcessed = 0;
		anyPlugin.termSimilarityProcessingStartedAt = 0;
		anyPlugin.termSimilarityStartedAt = 0;
	} catch {
		// ignore
	}
	try {
		anyPlugin.termSimilarityStoreCache = null;
		anyPlugin.termSimilarityStoreDirtyUpdates = 0;
		anyPlugin.termSimilarityStoreLastWriteAt = 0;
	} catch {
		// ignore
	}
}

export function clearSemanticRuntimeState(plugin: EpochPlugin): void {
	const anyPlugin: any = plugin as any;
	try {
		anyPlugin.similarityResetKey = (typeof anyPlugin.similarityResetKey === "number" ? anyPlugin.similarityResetKey : 0) + 1;
	} catch {
		// ignore
	}
	try {
		const t = anyPlugin?.similarityQueueTimer;
		if (t) clearTimeout(t);
	} catch {
		// ignore
	}
	try {
		anyPlugin.similarityQueueTimer = null;
		anyPlugin.similarityQueueRunning = false;
		anyPlugin.similarityPendingFiles = new Set<string>();
		anyPlugin.similarityQueueTotal = 0;
		anyPlugin.similarityQueueProcessed = 0;
		anyPlugin.similarityVectorUpdateProcessingStartedAt = 0;
		anyPlugin.similarityVectorUpdateStartedAt = 0;
	} catch {
		// ignore
	}
	try {
		anyPlugin.similarityStoreCache = null;
		anyPlugin.similarityStoreDirtyUpdates = 0;
		anyPlugin.similarityStoreLastWriteAt = 0;
	} catch {
		// ignore
	}
}

export function clearAllAiSummaries(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	const files: Record<string, any> = indexerAny?.files ?? {};
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	let cleared = 0;
	const clearEntry = (e: any): boolean => {
		if (!e) return false;
		const s = typeof e.aiSummary === "string" ? String(e.aiSummary).trim() : "";
		const h = typeof e.aiSummaryInputHash === "string" ? String(e.aiSummaryInputHash).trim() : "";
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
			if (clearEntry((data as any)?.cdate)) changed = true;
			if (clearEntry((data as any)?.namedDate)) changed = true;
			for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) {
				if (clearEntry(e)) changed = true;
			}
			const tracked = (data as any)?.trackedDates ?? {};
			for (const list of Object.values(tracked)) {
				for (const e of Array.isArray(list) ? list : []) {
					if (clearEntry(e)) changed = true;
				}
			}
		} catch {
			// ignore
		}
		if (changed) {
			try {
				indexerAny?.updateAggregatedEntries?.(path);
			} catch {
				// ignore
			}
		}
	}

	try {
		for (const entries of Object.values(index)) {
			if (!Array.isArray(entries)) continue;
			for (const e of entries) {
				const anyE: any = e as any;
				const isEpoch = String(anyE?.file || "").startsWith("epoch://");
				if (isEpoch) continue;
				clearEntry(anyE);
			}
		}
	} catch {
		// ignore
	}
	return cleared;
}

export function hardResetTrackedState(plugin: EpochPlugin): boolean {
	const indexerAny: any = plugin.indexer as any;
	const files: Record<string, any> = indexerAny?.files ?? {};
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	let changed = false;

	for (const [path, data] of Object.entries(files)) {
		let fileChanged = false;
		try {
			const anyData: any = data as any;
			const tracked = anyData?.trackedDates;
			if (tracked && typeof tracked === "object" && Object.keys(tracked).length > 0) {
				anyData.trackedDates = {};
				fileChanged = true;
			}
			if (anyData?.trackedSnapshot != null) {
				anyData.trackedSnapshot = null;
				fileChanged = true;
			}
			if (anyData?.trackedSnapshotDate != null) {
				anyData.trackedSnapshotDate = null;
				fileChanged = true;
			}
			if (anyData?.trackedBaselineSnapshot != null) {
				anyData.trackedBaselineSnapshot = null;
				fileChanged = true;
			}
			if (anyData?.trackedBaselineDate != null) {
				anyData.trackedBaselineDate = null;
				fileChanged = true;
			}
		} catch {
			// ignore
		}
		if (fileChanged) {
			changed = true;
			try {
				indexerAny?.updateAggregatedEntries?.(path);
			} catch {
				// ignore
			}
		}
	}

	try {
		for (const [date, entries] of Object.entries(index)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const kept = entries.filter((e: any) => (e as any)?.source !== "tracked");
			if (kept.length === entries.length) continue;
			changed = true;
			if (kept.length > 0) {
				(index as any)[date] = kept;
			} else {
				delete (index as any)[date];
			}
		}
	} catch {
		// ignore
	}

	return changed;
}

export function clearEpochEntries(plugin: EpochPlugin): number {
	const indexerAny: any = plugin.indexer as any;
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	let removed = 0;
	for (const [date, entries] of Object.entries(index)) {
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const kept = entries.filter((e: any) => {
			const anyE: any = e as any;
			const isEpoch = String(anyE?.file || "").startsWith("epoch://");
			if (isEpoch) removed++;
			return !isEpoch;
		});
		index[date] = kept;
	}
	return removed;
}
