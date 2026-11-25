import { isDateSource, normalizePinMode, type DateEntry, type FileIndexData, type SerializedEpochIndex } from "./types";
import { copyRecurringReviewStates, normalizeReviewState, reviewTimestamp } from "./review-state";

function isCurrentEntry(entry: DateEntry | null | undefined): entry is DateEntry { return !!entry && isDateSource(entry.source); }
function copyEntry(entry: DateEntry): DateEntry {
	return { date: entry.date, originalDate: entry.originalDate, file: entry.file, blockStart: entry.blockStart, blockEnd: entry.blockEnd, summary: entry.summary, source: entry.source, fromFrontmatter: entry.fromFrontmatter, namedDateRange: entry.namedDateRange, recurring: entry.recurring, icsSynced: entry.icsSynced, markColor: entry.markColor, markColorHex: entry.markColorHex, pinned: entry.pinned, fileMtimeMs: entry.fileMtimeMs, ...(entry.reviewState || entry.reviewStateUpdatedAt ? { reviewState: normalizeReviewState(entry.reviewState), reviewStateUpdatedAt: reviewTimestamp(entry.reviewStateUpdatedAt) || undefined } : {}) };
}
export function normalizeSerializedEpochIndexForDisk(serialized: SerializedEpochIndex): SerializedEpochIndex {
	const files: Record<string, FileIndexData> = {};
	for (const path of Object.keys(serialized.files).sort()) {
		const data = serialized.files[path];
		files[path] = {
			cdate: isCurrentEntry(data.cdate) ? copyEntry(data.cdate) : null,
			namedDate: isCurrentEntry(data.namedDate) ? copyEntry(data.namedDate) : null,
			dateProp: isCurrentEntry(data.dateProp) ? copyEntry(data.dateProp) : null,
			contentDates: data.contentDates.filter(isCurrentEntry).map(copyEntry),
			noparsed: data.noparsed, anchorUsesMdate: data.anchorUsesMdate,
			indexedMtimeMs: data.indexedMtimeMs, indexedSize: data.indexedSize,
			contentHash: data.contentHash, bodyHash: data.bodyHash,
			markColor: data.markColor, markColorHex: data.markColorHex,
			pinnedFile: normalizePinMode(data.pinnedFile),
			...(data.recurringReviewStates ? { recurringReviewStates: copyRecurringReviewStates(data) } : {}),
			recur: data.recur ? { raw: data.recur.raw, line: data.recur.line, from: data.recur.from, until: data.recur.until, count: data.recur.count, rrule: data.recur.rrule, kind: data.recur.kind } : null
		};
	}
	const dates: Record<string, DateEntry[]> = {};
	for (const date of Object.keys(serialized.dates).sort()) {
		const entries = serialized.dates[date].filter(e => isCurrentEntry(e) && !e.recurring).map(copyEntry);
		if (entries.length) dates[date] = entries;
	}
	return { files, dates };
}
