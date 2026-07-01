import { sortIndex } from "./indexer-utils";
import type { EpochIndex, FileIndexData } from "./types";

interface TrackedBaselineState {
	files: Record<string, FileIndexData>;
	index: EpochIndex;
	updateAggregatedEntries(filePath: string, options?: { skipSort?: boolean }): void;
}

function asState(indexer: unknown): TrackedBaselineState {
	return indexer as TrackedBaselineState;
}

function pruneTrackedEntriesFromIndex(indexer: unknown): boolean {
	const s = asState(indexer);
	let changed = false;
	for (const dateKey of Object.keys(s.index)) {
		const entries = s.index[dateKey];
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const filtered = entries.filter(entry => entry.source !== "tracked");
		if (filtered.length === entries.length) continue;
		changed = true;
		if (filtered.length > 0) {
			s.index[dateKey] = filtered;
		} else {
			delete s.index[dateKey];
		}
	}
	return changed;
}

function pruneTrackedEntriesFromIndexForPath(indexer: unknown, filePath: string): boolean {
	const s = asState(indexer);
	const target = String(filePath || "");
	if (!target) return false;
	let changed = false;
	for (const dateKey of Object.keys(s.index)) {
		const entries = s.index[dateKey];
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const filtered = entries.filter(entry => entry.source !== "tracked" || entry.file !== target);
		if (filtered.length === entries.length) continue;
		changed = true;
		if (filtered.length > 0) {
			s.index[dateKey] = filtered;
		} else {
			delete s.index[dateKey];
		}
	}
	return changed;
}

export function clearTrackedChanges(indexer: unknown): boolean {
	const s = asState(indexer);
	let changed = false;
	for (const [path, data] of Object.entries(s.files)) {
		if (!data) continue;
		if (!data.trackedDates || Object.keys(data.trackedDates).length === 0) continue;
		data.trackedDates = {};
		data.trackedBaselineSnapshot = data.trackedSnapshot ?? null;
		data.trackedBaselineDate = data.trackedSnapshotDate ?? null;
		changed = true;
		s.updateAggregatedEntries(path, { skipSort: true });
	}
	const indexPruned = pruneTrackedEntriesFromIndex(indexer);
	if (changed || indexPruned) {
		s.index = sortIndex(s.index);
	}
	return changed || indexPruned;
}

export function clearTrackedChangesForPath(indexer: unknown, filePath: string): boolean {
	const s = asState(indexer);
	const target = String(filePath || "");
	if (!target) return false;
	let changed = false;
	const data = s.files?.[target];
	if (data && data.trackedDates && Object.keys(data.trackedDates).length > 0) {
		data.trackedDates = {};
		data.trackedBaselineSnapshot = data.trackedSnapshot ?? null;
		data.trackedBaselineDate = data.trackedSnapshotDate ?? null;
		changed = true;
		s.updateAggregatedEntries(target, { skipSort: true });
	}
	const indexPruned = pruneTrackedEntriesFromIndexForPath(indexer, target);
	if (changed || indexPruned) {
		s.index = sortIndex(s.index);
	}
	return changed || indexPruned;
}

export function prepareTrackedBaseline(indexer: unknown): void {
	const s = asState(indexer);
	for (const data of Object.values(s.files)) {
		if (!data) continue;
		if (!data.trackedDates || Object.keys(data.trackedDates).length === 0) continue;
		data.trackedDates = {};
		data.trackedBaselineSnapshot = data.trackedSnapshot ?? null;
		data.trackedBaselineDate = data.trackedSnapshotDate ?? null;
	}
}

export function resetTrackedBaseline(indexer: unknown): boolean {
	const s = asState(indexer);
	let removedTracked = false;
	const pathsToUpdate: string[] = [];
	for (const [path, data] of Object.entries(s.files)) {
		if (!data) continue;
		const tracked = data.trackedDates ?? {};
		const hasEntries = Object.values(tracked).some(entries => entries.length > 0);
		if (!hasEntries && Object.keys(tracked).length === 0) continue;
		if (hasEntries) {
			removedTracked = true;
		}
		data.trackedDates = {};
		data.trackedBaselineSnapshot = data.trackedSnapshot ?? null;
		data.trackedBaselineDate = data.trackedSnapshotDate ?? null;
		pathsToUpdate.push(path);
	}

	if (pathsToUpdate.length > 0) {
		for (const path of pathsToUpdate) {
			s.updateAggregatedEntries(path, { skipSort: true });
		}
		s.index = sortIndex(s.index);
	} else if (pruneTrackedEntriesFromIndex(indexer)) {
		s.index = sortIndex(s.index);
	}

	return removedTracked;
}

export function hasTrackedChanges(indexer: unknown): boolean {
	const s = asState(indexer);
	for (const data of Object.values(s.files)) {
		if (!data?.trackedDates) continue;
		for (const entries of Object.values(data.trackedDates)) {
			if (entries.length > 0) return true;
		}
	}
	return false;
}
