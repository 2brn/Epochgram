import type { EpochIndex, DateEntry } from "../indexer/types";
import {
	shouldRenderEntry,
	entryFileName,
	formatEntrySummary,
	selectTimelineEntries
} from "./epoch-canvas-utils";
import { SUMMARY_ENTRY_SEPARATOR } from "./epoch-canvas-constants";

interface DayData {
	ts: number;
	date: string;
	entries: DateEntry[];
	summary: string;
}

export function buildDayData(index: EpochIndex): DayData[] {
	const out: DayData[] = [];

	for (const date of Object.keys(index)) {
		const entries = index[date];
		if (!entries || entries.length === 0) continue;
		const filteredEntries = entries.filter(shouldRenderEntry);
		const visibleEntries = selectTimelineEntries(filteredEntries);
		if (visibleEntries.length === 0) continue;

		const [yyyy, mm, dd] = date.split("-");
		const ts = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));

		const summary = visibleEntries
			.map(entry => {
				const rendered =
					(formatEntrySummary(entry, {
						fallbackToFileName: true
					}) || "").trim();
				if (rendered) {
					return rendered;
				}
				return entryFileName(entry);
			})
			.filter(Boolean)
			.join(SUMMARY_ENTRY_SEPARATOR);

		out.push({
			ts,
			date,
			entries: visibleEntries,
			summary
		});
	}

	out.sort((a, b) => a.ts - b.ts);
	return out;
}