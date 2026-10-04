import type { DateEntry, EpochIndex, FileIndexData } from "../indexer/types";

export type ActiveFilePinIndexer = {
	getFileIndexData?: (path: string) => FileIndexData | null;
	index?: EpochIndex;
};

function getAnchorEntry(data: FileIndexData | null | undefined): DateEntry | null {
	return data?.namedDate ?? data?.dateProp ?? data?.cdate ?? null;
}

function dateKeyToTime(value: string): number {
	const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return Number.NEGATIVE_INFINITY;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return Number.NEGATIVE_INFINITY;
	}
	const date = new Date(year, month, day);
	return Number.isFinite(date.getTime()) ? date.getTime() : Number.NEGATIVE_INFINITY;
}

function getRefreshedSelectedTimelineEntry(
	indexer: ActiveFilePinIndexer | null | undefined,
	path: string,
	selectedEntry: DateEntry
): DateEntry | null {
	const selectedDate = String(selectedEntry.date || "");
	if (!selectedDate) return null;
	const selectedSource = selectedEntry.source;
	const selectedStart = Number(selectedEntry.blockStart);
	const selectedEnd = Number(selectedEntry.blockEnd);
	let closest: DateEntry | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const entries of Object.values(indexer?.index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || entry.file !== path || entry.date !== selectedDate || entry.source !== selectedSource) continue;
			const entryStart = Number(entry.blockStart);
			const entryEnd = Number(entry.blockEnd);
			if (entryStart === selectedStart && entryEnd === selectedEnd) return entry;
			const distance = Math.abs(entryStart - selectedStart) + Math.abs(entryEnd - selectedEnd);
			if (distance < closestDistance) {
				closest = entry;
				closestDistance = distance;
			}
		}
	}
	return closest;
}

/** Resolves the same record used for an opened file's transient dock pin. */
export function resolveActiveFilePinEntry(
	indexer: ActiveFilePinIndexer | null | undefined,
	path: string,
	selectedEntry: DateEntry | null | undefined
): DateEntry | null {
	if (selectedEntry?.file === path && selectedEntry.date) {
		// Keep the clicked record/date, but use current index data when available.
		return getRefreshedSelectedTimelineEntry(indexer, path, selectedEntry) ?? selectedEntry;
	}

	let anchor: DateEntry | null = null;
	try {
		anchor = getAnchorEntry(indexer?.getFileIndexData?.(path) ?? null);
	} catch {
		// Fall back to the aggregated index below.
	}
	if (anchor?.date) return anchor;

	let best: DateEntry | null = null;
	let bestPriority = Number.POSITIVE_INFINITY;
	let bestDate = Number.NEGATIVE_INFINITY;
	for (const entries of Object.values(indexer?.index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || entry.file !== path || !entry.date) continue;
			const priority = entry.source === "namedate"
				? 0
				: entry.source === "dateprop"
					? 1
					: entry.source === "cdate"
						? 2
						: entry.source === "content"
							? 3
							: 4;
			const date = dateKeyToTime(entry.date);
			if (priority < bestPriority || (priority === bestPriority && date > bestDate)) {
				best = entry;
				bestPriority = priority;
				bestDate = date;
			}
		}
	}
	return best;
}
