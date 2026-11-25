import type { EpochCanvas } from "../epoch-canvas";
import { dateKeyToDate } from "../epoch-canvas-focus";
import { getEntriesCountForDateFast } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";
import { getSimilarScopeSignature, state } from "../entry-helpers/shared";
export type TimelineSearchCountCache = { key: string | null; value: number | null };
export function computeTimelineSearchResultCountAllDates(canvas: EpochCanvas, query: string, cache: TimelineSearchCountCache): number | null {
	if (!canvas) return null;
	const c = state(canvas);
	if (!c.index) return null;
	const parsed = parseTimelineQuery(query);
	if (parsed.invalid) return 0;
	const runtime = canvas as unknown as { __indexVersion?: number; plugin?: { __timelineSearchIndexVersion?: number } };
	const key = [query, runtime.__indexVersion, runtime.plugin?.__timelineSearchIndexVersion, c.showAttachments, c.showContentDates, c.showPropDates, c.showDraftsOnly, getSimilarScopeSignature(canvas, parsed), c.plugin?.__epochInheritedMarkComputedAt].join("|");
	if (cache.key === key) return cache.value;
	let total = 0;
	for (const date of Object.keys(c.index)) {
		if (parsed.dateRange && (date < parsed.dateRange.start || date > parsed.dateRange.end)) continue;
		const value = dateKeyToDate(date); if (value) total += getEntriesCountForDateFast(canvas, value);
	}
	cache.key = key; cache.value = total; return total;
}
