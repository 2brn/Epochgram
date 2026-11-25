import type { FileIndexData, ReviewMutation, SerializedEpochIndex } from "./types";
import { isLikelyTextFilePath } from "../utils";
import { applyReviewMutation, chooseReviewMutation, copyRecurringReviewStates, entryReviewMutation, reviewEntries, reviewEntryKey } from "./review-state";

function compatible(a: FileIndexData, b: FileIndexData): boolean {
	if (a.bodyHash && b.bodyHash) return a.bodyHash === b.bodyHash;
	if (a.contentHash && b.contentHash) return a.contentHash === b.contentHash;
	if (a.bodyHash || b.bodyHash || a.contentHash || b.contentHash) return false;
	const path = a.cdate?.file ?? a.namedDate?.file ?? a.dateProp?.file;
	// Attachments have no text fingerprint; preserve the established size-change policy.
	return !!path && !isLikelyTextFilePath(path) && typeof a.indexedSize === "number" && Number.isFinite(a.indexedSize) && a.indexedSize === b.indexedSize;
}
function states(data: FileIndexData): Map<string, ReviewMutation> {
	const out = new Map<string, ReviewMutation>();
	for (const entry of reviewEntries(data)) {
		const key = reviewEntryKey(entry), mutation = entryReviewMutation(entry), previous = out.get(key);
		out.set(key, previous ? chooseReviewMutation(previous, mutation) : mutation);
	}
	return out;
}
export function mergeFileReviewStates(local: FileIndexData, incoming: FileIndexData): boolean {
	if (!compatible(local, incoming)) return false;
	let changed = false;
	const other = states(incoming);
	for (const entry of reviewEntries(local)) {
		const mutation = other.get(reviewEntryKey(entry));
		if (mutation) changed = applyReviewMutation(entry, chooseReviewMutation(entryReviewMutation(entry), mutation)) || changed;
	}
	for (const [date, mutation] of Object.entries(copyRecurringReviewStates(incoming))) {
		const previous = local.recurringReviewStates?.[date];
		const winner = previous ? chooseReviewMutation(previous, mutation) : mutation;
		if (!previous || winner.state !== previous.state || winner.updatedAt !== previous.updatedAt) {
			(local.recurringReviewStates ??= {})[date] = { ...winner }; changed = true;
		}
	}
	return changed;
}
/** Merge only review metadata for matching current-schema content. No old files or schemas are read. */
export function mergeReviewStatesForSync(local: SerializedEpochIndex, incoming: SerializedEpochIndex): boolean {
	let changed = false;
	for (const [path, data] of Object.entries(local.files)) if (incoming.files[path]) changed = mergeFileReviewStates(data, incoming.files[path]) || changed;
	const byPath = new Map(Object.entries(local.files).map(([path, data]) => [path, states(data)]));
	for (const entries of Object.values(local.dates)) for (const entry of entries) {
		const mutation = entry.recurring ? local.files[entry.file]?.recurringReviewStates?.[entry.date] : byPath.get(entry.file)?.get(reviewEntryKey(entry));
		if (mutation) changed = applyReviewMutation(entry, mutation) || changed;
	}
	return changed;
}
