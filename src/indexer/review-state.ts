import type { DateEntry, FileIndexData, ReviewMutation, ReviewState } from "./types";

export function normalizeReviewState(value: unknown): ReviewState {
	return value === "reviewed" || value === "hidden" ? value : "draft";
}
export function isEntryHidden(entry: DateEntry): boolean { return entry.reviewState === "hidden"; }
export function isEntryDraft(entry: DateEntry): boolean { return normalizeReviewState(entry.reviewState) === "draft"; }
export function reviewEntries(data: FileIndexData): DateEntry[] {
	return [data.cdate, data.namedDate, data.dateProp, ...(data.contentDates ?? [])].filter((entry): entry is DateEntry => !!entry);
}
export function reviewTimestamp(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0; }
export function entryReviewMutation(entry: DateEntry): ReviewMutation { return { state: normalizeReviewState(entry.reviewState), updatedAt: reviewTimestamp(entry.reviewStateUpdatedAt) }; }
export function chooseReviewMutation(a: ReviewMutation, b: ReviewMutation): ReviewMutation {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
	const rank = { draft: 0, reviewed: 1, hidden: 2 };
	return rank[a.state] >= rank[b.state] ? a : b;
}
export function applyReviewMutation(entry: DateEntry, mutation: ReviewMutation): boolean {
	const before = entryReviewMutation(entry);
	if (before.state === mutation.state && before.updatedAt === mutation.updatedAt) return false;
	if (mutation.state === "draft") delete entry.reviewState;
	else entry.reviewState = mutation.state;
	if (mutation.updatedAt) entry.reviewStateUpdatedAt = mutation.updatedAt;
	else delete entry.reviewStateUpdatedAt;
	return true;
}
export function nextReviewTimestamp(data: FileIndexData): number {
	let latest = 0;
	for (const entry of reviewEntries(data)) latest = Math.max(latest, reviewTimestamp(entry.reviewStateUpdatedAt));
	for (const mutation of Object.values(data.recurringReviewStates ?? {})) latest = Math.max(latest, reviewTimestamp(mutation.updatedAt));
	return Math.max(Date.now(), latest + 1);
}
export function reviewEntryKey(entry: DateEntry): string {
	return entry.source === "content" || entry.namedDateRange ? `${entry.source}|${entry.originalDate || entry.date}` : entry.source;
}
export function copyRecurringReviewStates(data: FileIndexData): Record<string, ReviewMutation> {
	const out: Record<string, ReviewMutation> = {};
	for (const [date, mutation] of Object.entries(data.recurringReviewStates ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(date) && mutation && reviewTimestamp(mutation.updatedAt)) out[date] = { state: normalizeReviewState(mutation.state), updatedAt: mutation.updatedAt };
	}
	return out;
}
export function carryReviewState(previous: FileIndexData | undefined, next: FileIndexData): void {
	if (!previous) return;
	const states = new Map<string, ReviewMutation>();
	for (const entry of reviewEntries(previous)) {
		const key = reviewEntryKey(entry), mutation = entryReviewMutation(entry), old = states.get(key);
		states.set(key, old ? chooseReviewMutation(old, mutation) : mutation);
	}
	for (const entry of reviewEntries(next)) {
		const mutation = states.get(reviewEntryKey(entry));
		if (mutation) applyReviewMutation(entry, mutation);
	}
	if (previous.recurringReviewStates) next.recurringReviewStates = copyRecurringReviewStates(previous);
}
export function resetReviewedAnchors(data: FileIndexData): void {
	const mutation: ReviewMutation = { state: "draft", updatedAt: nextReviewTimestamp(data) };
	for (const entry of [data.cdate, data.namedDate, data.dateProp]) if (entry?.reviewState === "reviewed") applyReviewMutation(entry, mutation);
}
