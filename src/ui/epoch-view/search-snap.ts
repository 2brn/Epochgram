import type { DateEntry } from "../../indexer/types";
import { buildMiniSearchQueryParts } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";

interface SearchSnapIndexLike {
	searchFileIdsRanked(options: {
		includeText: string;
		exactPhrases: string[];
		excludedPhrases: string[];
		excludeTokens: string[];
	}): string[];
}

interface SearchSnapCanvasLike {
	snapFirstFilteredTimelineRecord(options: { draw?: boolean }): boolean;
	hasVisibleEntryForFile(path: string, line: number): boolean;
	snapInitialPosition(path: string, line: number, options: { draw?: boolean }): void;
}

interface SearchSnapViewLike {
	canvas?: SearchSnapCanvasLike | null;
	plugin?: { timelineSearchIndex?: SearchSnapIndexLike | null } | null;
	searchQuery?: string | null;
	pickBestMatchEntryForRankedPaths?(rankedPaths: string[], parsed: ReturnType<typeof parseTimelineQuery>): { path: string; entry: DateEntry } | null;
}

export function epochViewSnapToBestTimelineSearchMatch(view: unknown, options: { draw?: boolean } = {}): boolean {
	const state = view as SearchSnapViewLike;
	try {
		if (!state?.canvas) return false;
		const q = String(state.searchQuery || "").trim();
		if (!q) return false;

		const idx = state.plugin?.timelineSearchIndex;
		const parsed = parseTimelineQuery(q);
		const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
		if (!hasAnySearch) {
			return state.canvas.snapFirstFilteredTimelineRecord({ draw: options.draw });
		}
		if (!idx || typeof idx.searchFileIdsRanked !== "function") {
			return state.canvas.snapFirstFilteredTimelineRecord({ draw: options.draw });
		}

		let ranked: string[] = [];
		try {
			ranked = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases }) ?? [];
		} catch {
			ranked = [];
		}
		const rankedPaths: string[] = [];
		{
			const seen = new Set<string>();
			for (const fpRaw of Array.isArray(ranked) ? ranked : []) {
				const p = String(fpRaw ?? "");
				if (!p) continue;
				if (seen.has(p)) continue;
				seen.add(p);
				rankedPaths.push(p);
				if (rankedPaths.length >= 50) break;
			}
		}
		if (rankedPaths.length === 0) return false;

		const best = state.pickBestMatchEntryForRankedPaths?.(rankedPaths, parsed);
		if (!best) return false;
		const line = Math.max(0, Number(best.entry.blockStart ?? 0));
		if (!state.canvas.hasVisibleEntryForFile(best.path, line)) return false;
		state.canvas.snapInitialPosition(best.path, line, { draw: options.draw });
		return true;
	} catch {
		return false;
	}
}
