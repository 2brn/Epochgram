import { formatDate } from "utils";
import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry, EpochBucket } from "../../indexer/types";
import { isEpochBucket } from "../../indexer/types";
import { shouldRenderEntry, selectTimelineEntries, pickTimelineEntryForFile } from "../epoch-canvas-utils";
import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import {
	computeEffectiveFilters,
	dateKeyToUtcMs,
	getParsedTimelineQuery,
	isAttachmentEntry,
	isDateWithinRange,
	isPropDateEntry,
	state
} from "./shared";
import { matchesEpochEntrySearch, matchesSearch } from "./search";
import { getEpochsViewChildVisibilityByDateKey } from "./epochs-view";

type EntryWithEpochExtras = DateEntry & {
	namedDateRange?: boolean;
};

function inferEpochBucketFromEntry(entry: DateEntry | null | undefined): EpochBucket | null {
	if (!entry) return null;
	const raw = String(entry.epochBucket || "");
	if (raw && isEpochBucket(raw)) return raw;
	return null;
}

function epochRangeHasAnyVisibleChild(range: { start: string; end: string }, visibleByDateKey: Map<string, boolean>): boolean {
	const startMs = dateKeyToUtcMs(range.start);
	const endMs = dateKeyToUtcMs(range.end);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return true;
	if (endMs < startMs) return true;
	for (let t = startMs; t <= endMs; t += 86_400_000) {
		const key = new Date(t).toISOString().slice(0, 10);
		if (visibleByDateKey.get(key) === true) return true;
	}
	return false;
}

export function getEntriesForDate(
	canvas: EpochCanvas,
	date: Date,
	options: { includeAll?: boolean; epochBucket?: EpochBucket } = {}
): DateEntry[] {
	const s = state(canvas);
	const parsed = getParsedTimelineQuery(canvas);
	const effective = computeEffectiveFilters(canvas, s, parsed);
	const { index, epochsView } = s;
	const key = formatDate(date);
	const rawEntries = (index as Record<string, DateEntry[] | undefined>)[key];
	if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
		return [];
	}
	if (options.includeAll === true) {
		return rawEntries.slice();
	}
	if (parsed.dateRange && !isDateWithinRange(key, parsed.dateRange)) {
		return [];
	}
	let entries = rawEntries.slice();
	if (epochsView) {
		// Treat the epoch-entry search fallback as active only when there is actual
		// search text/phrases.
		const searchActive =
			String(parsed?.fuzzyText || "").trim().length > 0 ||
			(parsed?.exactPhrases?.length ?? 0) > 0 ||
			(parsed?.excludedPhrases?.length ?? 0) > 0;
		entries = entries.filter(entry => {
			if (!entry) return false;
			return entry.file.startsWith("epoch://");
		});
		if (options.epochBucket) {
			entries = entries.filter(entry => inferEpochBucketFromEntry(entry) === options.epochBucket);
		}
		if (!effective.showHidden) {
			entries = entries.filter(shouldRenderEntry);
		}
		// Respect filters by showing only epochs whose date range contains at least one
		// child record that would be visible under the current filter set.
		const visibleByDateKey = getEpochsViewChildVisibilityByDateKey(canvas);
		entries = entries.filter(entry => {
			const range = getEpochRangeFromEntry(entry);
			if (!range) return searchActive ? matchesEpochEntrySearch(canvas, entry, parsed) : true;
			const hasVisibleChild = epochRangeHasAnyVisibleChild(range, visibleByDateKey);
			if (!searchActive) return hasVisibleChild;
			return hasVisibleChild || matchesEpochEntrySearch(canvas, entry, parsed);
		});
		entries = selectTimelineEntries(entries);
		return entries;
	}
	entries = entries.filter(entry => !entry.file.startsWith("epoch://"));
	if (effective.showDraftOnly && !effective.hiddenOnly) {
		entries = entries.filter(entry => entry.reviewState === "draft");
	}
	if (!effective.showAttachments) {
		entries = entries.filter(entry => !isAttachmentEntry(entry));
	}
	if (!effective.showTrackedChanges) {
		entries = entries.filter(entry => entry.source !== "tracked");
	}
	if (effective.hiddenOnly) {
		entries = entries.filter(entry => entry.reviewState === "hidden");
	} else if (!effective.showHidden) {
		entries = entries.filter(shouldRenderEntry);
	}
	if (!effective.showContentDates && !effective.showPropDates) {
		entries = entries.filter(entry => !(entry.source === "namedate" && (entry as EntryWithEpochExtras).namedDateRange === true));
	}
	if (!effective.showContentDates) {
		entries = entries.filter(entry => entry.source !== "content");
	}
	if (!effective.showPropDates) {
		entries = entries.filter(entry => {
			if (entry.recurring === true) return true;
			return !(entry.source === "content" && isPropDateEntry(entry));
		});
	}
	entries = entries.filter(entry => matchesSearch(canvas, entry));
	entries = selectTimelineEntries(entries);
	return entries;
}

export function getEntriesCountForDateFast(
	canvas: EpochCanvas,
	date: Date,
	options: { includeAll?: boolean; epochBucket?: EpochBucket } = {}
): number {
	const s = state(canvas);
	const { index, epochsView } = s;
	const parsed = getParsedTimelineQuery(canvas);
	const effective = computeEffectiveFilters(canvas, s, parsed);
	const key = formatDate(date);
	const rawEntries = (index as Record<string, DateEntry[] | undefined>)[key];
	if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
		return 0;
	}
	if (options.includeAll === true) {
		return rawEntries.length;
	}
	if (parsed.dateRange && !isDateWithinRange(key, parsed.dateRange)) {
		return 0;
	}
	if (epochsView) {
		const searchActive =
			String(parsed?.fuzzyText || "").trim().length > 0 ||
			(parsed?.exactPhrases?.length ?? 0) > 0 ||
			(parsed?.excludedPhrases?.length ?? 0) > 0;
		let epochEntries: DateEntry[] = [];
		for (const entry of rawEntries) {
			if (!entry) continue;
			if (!entry.file.startsWith("epoch://")) continue;
			if (options.epochBucket && inferEpochBucketFromEntry(entry) !== options.epochBucket) continue;
			epochEntries.push(entry);
		}
		if (epochEntries.length === 0) return 0;
		if (!effective.showHidden) {
			epochEntries = epochEntries.filter(shouldRenderEntry);
		}
		if (epochEntries.length === 0) return 0;
		const visibleByDateKey = getEpochsViewChildVisibilityByDateKey(canvas);
		epochEntries = epochEntries.filter(entry => {
			const range = getEpochRangeFromEntry(entry);
			if (!range) return searchActive ? matchesEpochEntrySearch(canvas, entry, parsed) : true;
			const hasVisibleChild = epochRangeHasAnyVisibleChild(range, visibleByDateKey);
			if (!searchActive) return hasVisibleChild;
			return hasVisibleChild || matchesEpochEntrySearch(canvas, entry, parsed);
		});
		epochEntries = selectTimelineEntries(epochEntries);
		return epochEntries.length;
	}

	let files: Set<string> | null = null;
	let count = 0;
	for (const entry of rawEntries) {
		if (!entry) continue;
		if (String(entry.file || "").startsWith("epoch://")) continue;
		if (effective.showDraftOnly && !effective.hiddenOnly && entry.reviewState !== "draft") continue;
		if (!effective.showAttachments && isAttachmentEntry(entry)) continue;
		const isRecurring = entry.recurring === true;
		const isNamedDateRange = entry.source === "namedate" && (entry as EntryWithEpochExtras).namedDateRange === true;
		if (isNamedDateRange && !effective.showContentDates && !effective.showPropDates) continue;
		if (!effective.showContentDates && entry.source === "content") continue;
		if (!effective.showPropDates && entry.source === "content" && isPropDateEntry(entry) && !isRecurring) continue;
		if (!effective.showTrackedChanges) {
			if (entry.source === "tracked") continue;
		}
		if (effective.hiddenOnly && entry.reviewState !== "hidden") continue;
		if (!effective.hiddenOnly && !effective.showHidden && !shouldRenderEntry(entry)) continue;
		if (!matchesSearch(canvas, entry)) continue;

		const file = String(entry.file || "");
		if (!file) continue;
		if (!files) files = new Set();
		if (files.has(file)) continue;
		files.add(file);
		count++;
	}
	return count;
}

export function findEntryForDateMenu(canvas: EpochCanvas, date: Date, filePath: string): DateEntry | null {
	const entries = getEntriesForDate(canvas, date, { includeAll: true });
	if (entries.length === 0) {
		return null;
	}
	const matches = entries.filter(entry => entry.file === filePath);
	if (matches.length === 0) {
		return null;
	}
	const preferred =
		matches.find(entry => entry.source === "namedate") ||
		matches.find(entry => entry.source === "dateprop") ||
		matches.find(entry => entry.source === "cdate") ||
		matches.find(entry => entry.source === "content") ||
		matches[0];
	return preferred ?? null;
}

export function findPinnedEntryForDate(canvas: EpochCanvas, date: Date): DateEntry | null {
	const entries = getEntriesForDate(canvas, date);
	if (entries.length === 0) {
		return null;
	}
	const pinnedEntries = entries.filter(entry => entry.pinned === true);
	if (pinnedEntries.length !== 1) {
		return null;
	}
	return pinnedEntries[0];
}

export function pickEntryForFile(
	canvas: EpochCanvas,
	entries: DateEntry[],
	file: string,
	line: number | null,
	options?: { bypassAttachmentsFilter?: boolean; bypassDateFilters?: boolean }
): DateEntry | null {
	const s = state(canvas);
	const parsed = getParsedTimelineQuery(canvas);
	const effective = computeEffectiveFilters(canvas, s, parsed);
	let candidates = entries.filter(entry => entry.file === file);
	candidates = candidates.filter(entry => matchesSearch(canvas, entry));
	if (effective.showDraftOnly && !effective.hiddenOnly) {
		candidates = candidates.filter(entry => entry.reviewState === "draft");
	}
	if (!effective.showAttachments && !options?.bypassAttachmentsFilter) {
		candidates = candidates.filter(entry => !isAttachmentEntry(entry));
	}
	if (!options?.bypassDateFilters) {
		if (!effective.showContentDates && !effective.showPropDates) {
				candidates = candidates.filter(entry => !(entry.source === "namedate" && (entry as EntryWithEpochExtras).namedDateRange === true));
		}
		if (!effective.showContentDates) {
			candidates = candidates.filter(entry => entry.source !== "content");
		}
		if (!effective.showPropDates) {
			candidates = candidates.filter(entry => {
					if (entry.recurring === true) return true;
				return !(entry.source === "content" && isPropDateEntry(entry));
			});
		}
	}
	if (!effective.showTrackedChanges) {
		candidates = candidates.filter(entry => entry.source !== "tracked");
	}
	if (effective.hiddenOnly) {
		candidates = candidates.filter(entry => entry.reviewState === "hidden");
	} else if (!effective.showHidden) {
		candidates = candidates.filter(shouldRenderEntry);
	}
	if (candidates.length === 0) {
		return null;
	}
	if (line != null) {
		const containing = candidates.filter(entry => {
			const start = entry.blockStart ?? 0;
			const end = entry.blockEnd ?? start;
			return line >= start && line <= end;
		});
		if (containing.length > 0) {
			return pickTimelineEntryForFile(containing) ?? containing[0] ?? null;
		}
		let bestDistance = Number.POSITIVE_INFINITY;
		let closest: DateEntry[] = [];
		for (const entry of candidates) {
			const start = entry.blockStart ?? 0;
			const end0 = entry.blockEnd ?? start;
			const end = Math.max(start, end0);
			const dist = line < start ? start - line : line > end ? line - end : 0;
			if (dist < bestDistance) {
				bestDistance = dist;
				closest = [entry];
			} else if (dist === bestDistance) {
				closest.push(entry);
			}
		}
		if (closest.length > 0) {
			return pickTimelineEntryForFile(closest) ?? closest[0] ?? null;
		}
	}
	return pickTimelineEntryForFile(candidates) ?? candidates[0] ?? null;
}
