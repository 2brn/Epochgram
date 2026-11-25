import type { DateEntry, FileDateEntry, FileIndexData } from "./types";
import { carryReviewState } from "./review-state";

export function applyEntryState(previous: FileIndexData | undefined, next: FileIndexData): void {
	const explicit = typeof next.markColorHex === "string" || typeof next.markColor === "number";
	if (!explicit) {
		next.markColor = previous?.markColor;
		next.markColorHex = previous?.markColorHex;
	}
	carryReviewState(previous, next);
	applyHighlightState(next);
}

export function applyHighlightState(data: FileIndexData): void {
	const raw = data.markColor;
	const color = typeof raw === "number" && Number.isFinite(raw) && Math.floor(raw) > 0 ? Math.floor(raw) : undefined;
	const hex = typeof data.markColorHex === "string" ? data.markColorHex.trim() : "";
	data.markColor = color;
	if (hex) data.markColorHex = hex;
	else delete data.markColorHex;
	for (const entry of gatherFileEntries(data)) {
		entry.markColor = color;
		if (hex) entry.markColorHex = hex;
		else delete entry.markColorHex;
	}
}

export function gatherFileEntries(data: FileIndexData | undefined | null): FileDateEntry[] {
	if (!data) return [];
	return [data.cdate, data.namedDate, data.dateProp, ...(data.contentDates ?? [])].filter((e): e is FileDateEntry => e != null);
}

export function entryEffectiveDate(entry: DateEntry | null | undefined): string {
	return entry?.originalDate || entry?.date || "";
}

export function entrySignature(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	return [entry.file, entry.source, entryEffectiveDate(entry), entry.blockStart, entry.blockEnd].join("|");
}
