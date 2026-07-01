import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import { dateKeyToDate, getSourcePriority } from "../epoch-canvas-focus";
import { pickEntryForFile } from "../entry-helpers";
import type { parseTimelineQuery } from "../timeline-search";

type SearchBestMatchCanvasLike = {
	index?: Record<string, unknown>;
};

type SearchBestMatchParsed = ReturnType<typeof parseTimelineQuery>;

export function pickBestMatchEntryForRankedPaths(
	canvas: EpochCanvas,
	rankedPaths: string[],
	parsed: SearchBestMatchParsed
): { path: string; entry: DateEntry } | null {
	try {
		if (!canvas) return null;
		const canvasState = canvas as unknown as SearchBestMatchCanvasLike;
		const index = canvasState.index ?? null;
		if (!index || typeof index !== "object") return null;

		const wanted = new Set(rankedPaths);
		const bestByPath = new Map<string, { priority: number; ms: number; entry: DateEntry }>();

		for (const dateKey of Object.keys(index)) {
			if (parsed?.dateRange && (dateKey < parsed.dateRange.start || dateKey > parsed.dateRange.end)) {
				continue;
			}
			const rawEntries = index[dateKey];
			if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
			const dt = dateKeyToDate(dateKey);
			if (!dt) continue;
			const ms = dt.getTime();
			if (!Number.isFinite(ms)) continue;
			const byPath = new Map<string, DateEntry[]>();
			for (const entry of rawEntries) {
				if (!entry || typeof entry !== "object") continue;
				const typedEntry = entry as DateEntry;
				const fp = String(typedEntry.file ?? "");
				if (!fp) continue;
				if (!wanted.has(fp)) continue;
				let arr = byPath.get(fp);
				if (!arr) {
					arr = [];
					byPath.set(fp, arr);
				}
				arr.push(typedEntry);
			}
			if (byPath.size === 0) continue;
			for (const [fp, list] of byPath) {
				let picked: DateEntry | null = null;
				try {
					picked = pickEntryForFile(canvas, list, fp, null);
				} catch {
					picked = null;
				}
				if (!picked) continue;
				const priority = getSourcePriority(picked.source);
				const prev = bestByPath.get(fp);
				if (!prev || priority < prev.priority || (priority === prev.priority && ms > prev.ms)) {
					bestByPath.set(fp, { priority, ms, entry: picked });
				}
			}
		}

		for (const p of rankedPaths) {
			const best = bestByPath.get(p);
			if (best?.entry) return { path: p, entry: best.entry };
		}
		return null;
	} catch {
		return null;
	}
}
