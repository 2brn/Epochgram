import { buildMiniSearchQueryParts } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";

export function epochViewSnapToBestTimelineSearchMatch(view: any, options: { draw?: boolean } = {}): boolean {
	try {
		if (!view?.canvas) return false;
		const q = String(view.searchQuery || "").trim();
		if (!q) return false;

		const idx: any = view.plugin?.timelineSearchIndex;
		const parsed = parseTimelineQuery(q);
		const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
		if (!hasAnySearch) {
			return view.canvas.snapFirstFilteredTimelineRecord({ draw: options.draw });
		}
		if (!idx || typeof idx.searchFileIdsRanked !== "function") {
			return view.canvas.snapFirstFilteredTimelineRecord({ draw: options.draw });
		}

		let ranked: any[] = [];
		try {
			ranked = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases }) as any[];
		} catch {
			ranked = [];
		}
		const rankedPaths: string[] = [];
		{
			const seen = new Set<string>();
			for (const fpRaw of Array.isArray(ranked) ? ranked : []) {
				const p = String(fpRaw || "");
				if (!p) continue;
				if (seen.has(p)) continue;
				seen.add(p);
				rankedPaths.push(p);
				if (rankedPaths.length >= 50) break;
			}
		}
		if (rankedPaths.length === 0) return false;

		const best = view.pickBestMatchEntryForRankedPaths?.(rankedPaths, parsed);
		if (!best) return false;
		const line = Math.max(0, (best.entry as any)?.blockStart ?? 0);
		if (!view.canvas.hasVisibleEntryForFile(best.path, line)) return false;
		view.canvas.snapInitialPosition(best.path, line, { draw: options.draw });
		return true;
	} catch {
		return false;
	}
}
