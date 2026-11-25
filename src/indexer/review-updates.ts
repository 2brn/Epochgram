import type { DateEntry, EpochIndex, FileIndexData, ReviewMutation, ReviewState } from "./types";
import { applyReviewMutation, nextReviewTimestamp, normalizeReviewState, reviewEntries } from "./review-state";
import { bumpTimelineSearchIndexVersion } from "../plugin/timeline-search-cache";
import type { EpochPlugin } from "../main";

type State = { files: Record<string, FileIndexData>; index: EpochIndex; plugin: EpochPlugin; updateAggregatedEntries(path: string): void };
function state(indexer: unknown): State { return indexer as State; }
function refresh(s: State, path: string): void { s.updateAggregatedEntries(path); bumpTimelineSearchIndexVersion(s.plugin); }
function setOccurrence(data: FileIndexData, date: string, mutation: ReviewMutation): boolean {
	if (normalizeReviewState(data.recurringReviewStates?.[date]?.state) === mutation.state) return false;
	(data.recurringReviewStates ??= {})[date] = mutation;
	return true;
}
export function setEntryReviewState(indexer: unknown, target: DateEntry, desired: ReviewState): boolean {
	const s = state(indexer), data = s.files[target.file];
	if (!data) return false;
	const mutation: ReviewMutation = { state: desired, updatedAt: nextReviewTimestamp(data) };
	let changed = false;
	if (target.recurring) changed = setOccurrence(data, target.date, mutation);
	else {
		const date = target.originalDate || target.date;
		for (const entry of reviewEntries(data)) if ((entry.originalDate || entry.date) === date && normalizeReviewState(entry.reviewState) !== desired) changed = applyReviewMutation(entry, mutation) || changed;
	}
	if (changed) { applyReviewMutation(target, mutation); refresh(s, target.file); }
	return changed;
}
export function getFileReviewState(indexer: unknown, path: string): ReviewState {
	const data = state(indexer).files[path];
	const anchor = data?.namedDate ?? data?.dateProp ?? data?.cdate;
	return normalizeReviewState(anchor?.reviewState);
}
export function setFileReviewState(indexer: unknown, path: string, desired: ReviewState, preserveHidden = false): boolean {
	const s = state(indexer), data = s.files[path];
	if (!data) return false;
	const mutation: ReviewMutation = { state: desired, updatedAt: nextReviewTimestamp(data) };
	let changed = false;
	for (const entry of reviewEntries(data)) {
		if (preserveHidden && entry.reviewState === "hidden") continue;
		if (normalizeReviewState(entry.reviewState) !== desired) changed = applyReviewMutation(entry, mutation) || changed;
	}
	const dates = new Set(Object.keys(data.recurringReviewStates ?? {}));
	for (const entries of Object.values(s.index)) for (const entry of entries) if (entry.file === path && entry.recurring) dates.add(entry.date);
	for (const date of dates) {
		if (preserveHidden && data.recurringReviewStates?.[date]?.state === "hidden") continue;
		changed = setOccurrence(data, date, mutation) || changed;
	}
	if (changed) refresh(s, path);
	return changed;
}
export function clearFileReviewOverrides(indexer: unknown, path: string): boolean {
	return setFileReviewState(indexer, path, "draft", false);
}
