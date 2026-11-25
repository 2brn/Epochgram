import { formatDate } from "../../utils";
import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { selectTimelineEntries, pickTimelineEntryForFile } from "../epoch-canvas-utils";
import { computeEffectiveFilters, getParsedTimelineQuery, hasHiddenOnlyToken, isReviewVisible, isAttachmentEntry, isDateWithinRange, isPropDateEntry, state } from "./shared";
import { matchesSearch } from "./search";
function visible(canvas: EpochCanvas, entry: DateEntry, options?: { bypassAttachmentsFilter?: boolean; bypassDateFilters?: boolean }): boolean {
	const parsed = getParsedTimelineQuery(canvas);
	const filters = computeEffectiveFilters(canvas, state(canvas), parsed);
	if (!isReviewVisible(entry, state(canvas).showDraftsOnly === true, hasHiddenOnlyToken(parsed))) return false;
	if (!isDateWithinRange(entry.date, parsed.dateRange)) return false;
	if (!filters.showAttachments && !options?.bypassAttachmentsFilter && isAttachmentEntry(entry)) return false;
	if (!options?.bypassDateFilters) {
		if (!filters.showContentDates && !filters.showPropDates && (entry as DateEntry & { namedDateRange?: boolean }).namedDateRange) return false;
		if (!filters.showContentDates && (entry.source === "content" || entry.recurring)) return false;
		if (!filters.showPropDates && entry.source === "content" && isPropDateEntry(entry) && !entry.recurring) return false;
	}
	return matchesSearch(canvas, entry);
}
export function getEntriesForDate(canvas: EpochCanvas, date: Date, options: { includeAll?: boolean } = {}): DateEntry[] {
	const entries = state(canvas).index[formatDate(date)] ?? [];
	return options.includeAll ? entries.slice() : selectTimelineEntries(entries.filter(entry => visible(canvas, entry)));
}
export function getEntriesCountForDateFast(canvas: EpochCanvas, date: Date, options: { includeAll?: boolean } = {}): number { return getEntriesForDate(canvas, date, options).length; }
export function findEntryForDateMenu(canvas: EpochCanvas, date: Date, path: string): DateEntry | null {
	const entries = getEntriesForDate(canvas, date, { includeAll: true }).filter(entry => entry.file === path);
	return entries.find(e => e.source === "namedate") ?? entries.find(e => e.source === "dateprop") ?? entries.find(e => e.source === "cdate") ?? entries[0] ?? null;
}
export function findPinnedEntryForDate(canvas: EpochCanvas, date: Date): DateEntry | null {
	const entries = getEntriesForDate(canvas, date).filter(e => e.pinned);
	return entries.length === 1 ? entries[0] : null;
}
export function pickEntryForFile(canvas: EpochCanvas, entries: DateEntry[], file: string, line: number | null, options?: { bypassAttachmentsFilter?: boolean; bypassDateFilters?: boolean }): DateEntry | null {
	let candidates = entries.filter(entry => entry.file === file && visible(canvas, entry, options));
	if (line != null && candidates.length) {
		const distance = (e: DateEntry) => line < e.blockStart ? e.blockStart - line : line > e.blockEnd ? line - e.blockEnd : 0;
		const closest = Math.min(...candidates.map(distance));
		candidates = candidates.filter(entry => distance(entry) === closest);
	}
	return pickTimelineEntryForFile(candidates) ?? candidates[0] ?? null;
}
