import type {
	DateEntry,
	FileDateEntry,
	FileIndexData,
	ReviewState,
	SerializedEpochIndex
} from "./types";

type ReviewStateInfo = {
	state: ReviewState;
	updatedAt: number | null;
};

type RecurringDateKeys = {
	values: string[];
	updatedAt: number | null;
};

function normalizeReviewState(value: unknown): ReviewState {
	if (value === "hidden") return "hidden";
	if (value === "reviewed") return "reviewed";
	return "draft";
}

function reviewStateUpdatedAt(entry: DateEntry | null | undefined): number | null {
	const value = Number(entry?.reviewStateUpdatedAt);
	return Number.isFinite(value) && value > 0 ? value : null;
}

function reviewStateRank(state: ReviewState): number {
	if (state === "hidden") return 3;
	if (state === "reviewed") return 2;
	return 1;
}

function chooseReviewState(left: ReviewStateInfo, right: ReviewStateInfo): ReviewStateInfo {
	if (left.updatedAt != null && right.updatedAt != null) {
		if (right.updatedAt > left.updatedAt) return right;
		if (left.updatedAt > right.updatedAt) return left;
	} else if (right.updatedAt != null) {
		return right;
	} else if (left.updatedAt != null) {
		return left;
	}

	// Older indexes did not persist a mutation timestamp. During that migration,
	// retain an explicit Reviewed/Hidden state rather than silently demoting it
	// because another device rebuilt the same unchanged file as Draft.
	return reviewStateRank(right.state) > reviewStateRank(left.state) ? right : left;
}

function applyReviewState(entry: DateEntry, next: ReviewStateInfo, explicitDraft: boolean): boolean {
	const current: ReviewStateInfo = {
		state: normalizeReviewState(entry.reviewState),
		updatedAt: reviewStateUpdatedAt(entry)
	};
	if (current.state === next.state && current.updatedAt === next.updatedAt) return false;

	if (next.state === "draft") {
		if (explicitDraft) entry.reviewState = "draft";
		else delete entry.reviewState;
	} else {
		entry.reviewState = next.state;
	}
	if (next.updatedAt != null) entry.reviewStateUpdatedAt = next.updatedAt;
	else delete entry.reviewStateUpdatedAt;
	return true;
}

function effectiveDate(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	const original = typeof entry.originalDate === "string" ? entry.originalDate : "";
	return original || String(entry.date || "");
}

function entryKey(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	const source = String(entry.source || "");
	const date = effectiveDate(entry);
	if (!source || !date) return "";
	if (source === "tracked") {
		return [
			source,
			date,
			String(entry.trackedChange || ""),
			String(entry.trackedHash || entry.summary || "")
		].join("|");
	}
	return `${source}|${date}`;
}

function allEntries(data: FileIndexData | null | undefined): FileDateEntry[] {
	if (!data) return [];
	const entries: FileDateEntry[] = [];
	if (data.cdate) entries.push(data.cdate);
	if (data.namedDate) entries.push(data.namedDate);
	if (data.dateProp) entries.push(data.dateProp);
	entries.push(...(data.contentDates ?? []));
	for (const list of Object.values(data.trackedDates ?? {})) {
		if (Array.isArray(list)) entries.push(...list);
	}
	return entries;
}

function mergeEntryReviewState(local: FileDateEntry | null | undefined, incoming: FileDateEntry | null | undefined): boolean {
	if (!local || !incoming) return false;
	const winner = chooseReviewState(
		{ state: normalizeReviewState(local.reviewState), updatedAt: reviewStateUpdatedAt(local) },
		{ state: normalizeReviewState(incoming.reviewState), updatedAt: reviewStateUpdatedAt(incoming) }
	);
	return applyReviewState(local, winner, false);
}

function mergeEntryArrays(local: FileDateEntry[] | undefined, incoming: FileDateEntry[] | undefined): boolean {
	if (!Array.isArray(local) || !Array.isArray(incoming)) return false;
	const incomingByKey = new Map<string, FileDateEntry[]>();
	for (const entry of incoming) {
		const key = entryKey(entry);
		if (!key) continue;
		const list = incomingByKey.get(key) ?? [];
		list.push(entry);
		incomingByKey.set(key, list);
	}

	let changed = false;
	for (const entry of local) {
		const key = entryKey(entry);
		if (!key) continue;
		const matches = incomingByKey.get(key);
		if (!matches || matches.length === 0) continue;
		for (const match of matches) {
			if (mergeEntryReviewState(entry, match)) changed = true;
		}
	}
	return changed;
}

function normalizedDateKeys(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const out = new Set<string>();
	for (const value of values) {
		const date = String(value || "").trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.add(date);
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function reviewSetUpdatedAt(value: unknown): number | null {
	const updatedAt = Number(value);
	return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null;
}

function sameDateKeys(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function chooseRecurringDateKeys(
	localRaw: string[] | undefined,
	localUpdatedAtRaw: unknown,
	incomingRaw: string[] | undefined,
	incomingUpdatedAtRaw: unknown
): RecurringDateKeys {
	const local = normalizedDateKeys(localRaw);
	const incoming = normalizedDateKeys(incomingRaw);
	const localUpdatedAt = reviewSetUpdatedAt(localUpdatedAtRaw);
	const incomingUpdatedAt = reviewSetUpdatedAt(incomingUpdatedAtRaw);
	if (localUpdatedAt != null && incomingUpdatedAt != null) {
		if (incomingUpdatedAt > localUpdatedAt) return { values: incoming, updatedAt: incomingUpdatedAt };
		if (localUpdatedAt > incomingUpdatedAt) return { values: local, updatedAt: localUpdatedAt };
		const localKey = local.join("|");
		const incomingKey = incoming.join("|");
		return incomingKey > localKey
			? { values: incoming, updatedAt: incomingUpdatedAt }
			: { values: local, updatedAt: localUpdatedAt };
	}
	if (incomingUpdatedAt != null) return { values: incoming, updatedAt: incomingUpdatedAt };
	if (localUpdatedAt != null) return { values: local, updatedAt: localUpdatedAt };

	// Timestamp-less sets came from older versions. Retain both until a user
	// performs an explicit recurring review/hidden action on a current version.
	return {
		values: Array.from(new Set([...local, ...incoming])).sort((a, b) => a.localeCompare(b)),
		updatedAt: null
	};
}

function applyRecurringDateKeys(
	data: FileIndexData,
	key: "recurReviewedDates" | "recurHiddenDates",
	updatedAtKey: "recurReviewedDatesUpdatedAt" | "recurHiddenDatesUpdatedAt",
	next: RecurringDateKeys
): boolean {
	const current = normalizedDateKeys(data[key]);
	const currentUpdatedAt = reviewSetUpdatedAt(data[updatedAtKey]);
	if (sameDateKeys(current, next.values) && currentUpdatedAt === next.updatedAt) return false;
	data[key] = next.values;
	if (next.updatedAt != null) data[updatedAtKey] = next.updatedAt;
	else delete data[updatedAtKey];
	return true;
}

function resolveRecurringStateOverlap(data: FileIndexData): boolean {
	const reviewed = new Set(normalizedDateKeys(data.recurReviewedDates));
	const hidden = new Set(normalizedDateKeys(data.recurHiddenDates));
	const overlap = Array.from(reviewed).filter((date) => hidden.has(date));
	if (overlap.length === 0) return false;
	const reviewedUpdatedAt = reviewSetUpdatedAt(data.recurReviewedDatesUpdatedAt);
	const hiddenUpdatedAt = reviewSetUpdatedAt(data.recurHiddenDatesUpdatedAt);
	if (reviewedUpdatedAt != null && (hiddenUpdatedAt == null || reviewedUpdatedAt > hiddenUpdatedAt)) {
		for (const date of overlap) hidden.delete(date);
		const nextUpdatedAt = Math.max(reviewedUpdatedAt, hiddenUpdatedAt ?? 0);
		return applyRecurringDateKeys(data, "recurHiddenDates", "recurHiddenDatesUpdatedAt", {
			values: Array.from(hidden).sort((a, b) => a.localeCompare(b)),
			updatedAt: nextUpdatedAt
		});
	}
	for (const date of overlap) reviewed.delete(date);
	const nextUpdatedAt = Math.max(hiddenUpdatedAt ?? 0, reviewedUpdatedAt ?? 0) || null;
	return applyRecurringDateKeys(data, "recurReviewedDates", "recurReviewedDatesUpdatedAt", {
		values: Array.from(reviewed).sort((a, b) => a.localeCompare(b)),
		updatedAt: nextUpdatedAt
	});
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function finiteSize(value: unknown): number | null {
	const size = Number(value);
	return Number.isFinite(size) && size >= 0 ? size : null;
}

function areFileContentsCompatible(local: FileIndexData, incoming: FileIndexData): boolean {
	const localBodyHash = stringValue(local.bodyHash);
	const incomingBodyHash = stringValue(incoming.bodyHash);
	if (localBodyHash && incomingBodyHash) return localBodyHash === incomingBodyHash;

	const localContentHash = stringValue(local.contentHash);
	const incomingContentHash = stringValue(incoming.contentHash);
	if (localContentHash && incomingContentHash) return localContentHash === incomingContentHash;

	const localSize = finiteSize(local.indexedSize);
	const incomingSize = finiteSize(incoming.indexedSize);
	if (localSize != null && incomingSize != null) return localSize === incomingSize;

	// Legacy serialized indexes may not have a fingerprint. Keep the existing
	// state during that one-time migration; subsequent indexing writes hashes.
	return true;
}

function mergeFileReviewStates(local: FileIndexData, incoming: FileIndexData): boolean {
	if (!areFileContentsCompatible(local, incoming)) return false;
	let changed = false;
	if (mergeEntryReviewState(local.cdate, incoming.cdate)) changed = true;
	if (mergeEntryReviewState(local.namedDate, incoming.namedDate)) changed = true;
	if (mergeEntryReviewState(local.dateProp, incoming.dateProp)) changed = true;
	if (mergeEntryArrays(local.contentDates, incoming.contentDates)) changed = true;
	if (mergeEntryArrays(allTrackedEntries(local), allTrackedEntries(incoming))) changed = true;

	const reviewed = chooseRecurringDateKeys(
		local.recurReviewedDates,
		local.recurReviewedDatesUpdatedAt,
		incoming.recurReviewedDates,
		incoming.recurReviewedDatesUpdatedAt
	);
	if (applyRecurringDateKeys(local, "recurReviewedDates", "recurReviewedDatesUpdatedAt", reviewed)) changed = true;
	const hidden = chooseRecurringDateKeys(
		local.recurHiddenDates,
		local.recurHiddenDatesUpdatedAt,
		incoming.recurHiddenDates,
		incoming.recurHiddenDatesUpdatedAt
	);
	if (applyRecurringDateKeys(local, "recurHiddenDates", "recurHiddenDatesUpdatedAt", hidden)) changed = true;
	if (resolveRecurringStateOverlap(local)) changed = true;
	return changed;
}

function allTrackedEntries(data: FileIndexData): FileDateEntry[] {
	const entries: FileDateEntry[] = [];
	for (const list of Object.values(data.trackedDates ?? {})) {
		if (Array.isArray(list)) entries.push(...list);
	}
	return entries;
}

function fileEntryStates(data: FileIndexData): Map<string, ReviewStateInfo> {
	const states = new Map<string, ReviewStateInfo>();
	for (const entry of allEntries(data)) {
		const key = entryKey(entry);
		if (!key) continue;
		const next: ReviewStateInfo = {
			state: normalizeReviewState(entry.reviewState),
			updatedAt: reviewStateUpdatedAt(entry)
		};
		const current = states.get(key);
		states.set(key, current ? chooseReviewState(current, next) : next);
	}
	return states;
}

function syncDateEntriesFromFiles(serialized: SerializedEpochIndex): boolean {
	let changed = false;
	const statesByPath = new Map<string, Map<string, ReviewStateInfo>>();
	for (const [path, data] of Object.entries(serialized.files ?? {})) {
		statesByPath.set(path, fileEntryStates(data));
	}

	for (const entries of Object.values(serialized.dates ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || String(entry.file || "").startsWith("epoch://")) continue;
			const data = serialized.files?.[entry.file];
			if (!data) continue;

			if (entry.recurring === true) {
				const date = String(entry.date || "");
				const hidden = normalizedDateKeys(data.recurHiddenDates).includes(date);
				const reviewed = normalizedDateKeys(data.recurReviewedDates).includes(date);
				const state: ReviewStateInfo = {
					state: hidden ? "hidden" : reviewed ? "reviewed" : "draft",
					updatedAt: hidden
						? reviewSetUpdatedAt(data.recurHiddenDatesUpdatedAt)
						: reviewed
							? reviewSetUpdatedAt(data.recurReviewedDatesUpdatedAt)
							: null
				};
				const winner = chooseReviewState(
					{ state: normalizeReviewState(entry.reviewState), updatedAt: reviewStateUpdatedAt(entry) },
					state
				);
				if (applyReviewState(entry, winner, true)) changed = true;
				continue;
			}

			const state = statesByPath.get(entry.file)?.get(entryKey(entry));
			if (state) {
				const winner = chooseReviewState(
					{ state: normalizeReviewState(entry.reviewState), updatedAt: reviewStateUpdatedAt(entry) },
					state
				);
				if (applyReviewState(entry, winner, true)) changed = true;
			}
		}
	}
	return changed;
}

/**
 * Reconciles review state from two copies of the same synced index.
 *
 * `local` is mutated in place and retains its structural/indexing data. For
 * unchanged files, the newest explicit review mutation wins. Legacy entries
 * without a timestamp retain Reviewed/Hidden over an ambiguous Draft so a
 * delayed mobile rebuild cannot erase existing reviews.
 */
export function mergeReviewStatesForSync(local: SerializedEpochIndex, incoming: SerializedEpochIndex): boolean {
	let changed = false;
	for (const [path, localData] of Object.entries(local.files ?? {})) {
		const incomingData = incoming.files?.[path];
		if (!incomingData) continue;
		if (mergeFileReviewStates(localData, incomingData)) changed = true;
	}
	if (syncDateEntriesFromFiles(local)) changed = true;
	return changed;
}
