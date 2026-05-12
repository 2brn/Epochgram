import type { DateEntry, EpochBucket } from "../../indexer/types";
import { isEpochBucket } from "../../indexer/types";

import { TimelineSearchModal } from "../modals/timeline-search-modal";
import { openEntry as openEntryAction } from "../epoch-canvas-actions";
import { getEntryTitle } from "../epoch-canvas-helpers";
import { pickEpochBucketForViewport, SUMMARY_SEPARATOR_SYMBOL } from "../epoch-canvas-constants";
import { dateKeyToDate, getSourcePriority } from "../epoch-canvas-focus";
import { entryFileName, formatEntrySummary, getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { buildMiniSearchQueryParts, getEntriesForDate, pickEntryForFile } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";

export function openSearchModal(view: any): void {
	if (view.searchModalOpen) return;
	// Avoid jumping the canvas to the currently-open note when this modal opens/closes.
	// This can happen because active file regains focus after SuggestModal resolves.
	try {
		(view.canvas as any).__suppressExternalAutoScrollUntil = performance.now() + 1000;
		const activePath = view.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
		(view.canvas as any).suppressNextFocusScrollForPath?.(activePath);
	} catch {
		// ignore
	}
	view.searchModalOpen = true;
	const pushLastOpenedFromSearch = (filePath: string) => {
		const p = String(filePath || "");
		if (!p) return;
		try {
			const pluginAny: any = view.plugin as any;
			const prev = pluginAny.__timelineSearchLastOpenedFiles as string[] | null | undefined;
			const out: string[] = [];
			const seen = new Set<string>();
			seen.add(p);
			out.push(p);
			for (const it of Array.isArray(prev) ? prev : []) {
				const s = String(it || "");
				if (!s) continue;
				if (seen.has(s)) continue;
				seen.add(s);
				out.push(s);
				if (out.length >= 20) break;
			}
			pluginAny.__timelineSearchLastOpenedFiles = out;
		} catch {
			// ignore
		}
	};
	const getTopMatches = (raw: string, max: number): Array<{ entry: DateEntry; label?: string }> => {
		const q = String(raw || "");
		const limit = Math.max(0, Math.floor(max || 0));
		if (limit <= 0) return [];
		const qTrim = q.trim();
		const recentPaths: string[] = [];
		if (!qTrim) {
			const fromSearchRaw = (() => {
				try {
					return ((view.plugin as any)?.__timelineSearchLastOpenedFiles as string[] | null | undefined) ?? [];
				} catch {
					return [];
				}
			})();
			const activePath = (() => {
				try {
					return String((view.plugin as any)?.app?.workspace?.getActiveFile?.()?.path ?? "");
				} catch {
					return "";
				}
			})();
			const pathsRaw = (() => {
				try {
					return (view.app as any)?.workspace?.getLastOpenFiles?.() ?? [];
				} catch {
					return [];
				}
			})();
			const seen = new Set<string>();
			for (const pRaw of Array.isArray(fromSearchRaw) ? fromSearchRaw : []) {
				const p = String(pRaw || "");
				if (!p) continue;
				if (seen.has(p)) continue;
				seen.add(p);
				recentPaths.push(p);
				if (recentPaths.length >= limit) break;
			}
			if (activePath) {
				if (!seen.has(activePath)) {
					seen.add(activePath);
					if (recentPaths.length < limit) recentPaths.push(activePath);
				}
			}
			for (const pRaw of Array.isArray(pathsRaw) ? pathsRaw : []) {
				const p = String(pRaw || "");
				if (!p) continue;
				if (seen.has(p)) continue;
				seen.add(p);
				recentPaths.push(p);
				if (recentPaths.length >= limit) break;
			}
		}

		const parsed = parseTimelineQuery(q);
		const canvas: any = view.canvas as any;
		const index: any = canvas?.index ?? null;
		if (!index || typeof index !== "object") return [];
		const epochsViewActive = canvas?.epochsView === true;
		const currentEpochBucket: EpochBucket | null = (() => {
			if (!epochsViewActive) return null;
			try {
				const rawBucket = String(canvas?.epochsViewBucket ?? "");
				if (rawBucket && isEpochBucket(rawBucket)) return rawBucket;
			} catch {
				// ignore
			}
			try {
				const scale = Number(canvas?.scale ?? 1);
				let viewportHeight = 0;
				try {
					viewportHeight = Number(canvas?.root?.getBoundingClientRect?.()?.height ?? 0);
				} catch {
					viewportHeight = 0;
				}
				if (!(viewportHeight > 0)) {
					try {
						viewportHeight = Number(canvas?.canvas?.getBoundingClientRect?.()?.height ?? 0);
					} catch {
						viewportHeight = 0;
					}
				}
				if (!(viewportHeight > 0)) viewportHeight = 800;
				return pickEpochBucketForViewport(scale, viewportHeight) as any;
			} catch {
				return null;
			}
		})();

		// Use a query-scoped canvas wrapper so entry selection/filtering uses the
		// currently typed query (without committing it to the real view/canvas).
		const queryCanvas: any = Object.assign({}, canvas, { searchQuery: q });

		const labelForEntry = (entry: any, fallbackPath: string): string => {
			try {
				const isEpoch = String((entry as any)?.file ?? "").startsWith("epoch://");
				if (isEpoch) {
					const r = getEpochRangeFromEntry(entry as any);
					if (r?.start && r?.end) {
						const summary = String((entry as any)?.summary ?? "").trim();
						const aiSummary = String((entry as any)?.aiSummary ?? "").trim();
						const text = summary || aiSummary;
						return text ? `${r.start} - ${r.end} ${SUMMARY_SEPARATOR_SYMBOL} ${text}` : `${r.start} - ${r.end}`;
					}
				}
				const rawTitle = getEntryTitle(canvas, entry) || entryFileName(entry);
				const title =
					String(rawTitle || "")
						.replace(/\.md$/i, "")
						.trim() ||
					String(entryFileName(entry) || entry?.file || fallbackPath || "").replace(/\.md$/i, "");
				const displaySummary =
					(formatEntrySummary(entry, {
						fallbackToFileName: true,
						includeIcons: false,
					filenameWordsCount: view.plugin.settings.filenameWordsCount,
					summaryWordsCount: view.plugin.settings.summaryWordsCount
					}) || "").trim();
				const isFallbackSummary = displaySummary === title;
				const effectiveSummary = isFallbackSummary ? "" : displaySummary;
				return (effectiveSummary.length > 0 ? effectiveSummary : title) || fallbackPath;
			} catch {
				return fallbackPath;
			}
		};

		const scanMostRecentMatches = (excludeFiles: Set<string>): Array<{ entry: DateEntry; label?: string }> => {
			const out: Array<{ entry: DateEntry; label?: string }> = [];
			const cAny: any = canvas as any;
			const indexVersion = (() => {
				try {
					const n = Number(cAny?.__indexVersion ?? 0);
					return Number.isFinite(n) ? n : 0;
				} catch {
					return 0;
				}
			})();
			let keys: string[] | null = null;
			try {
				const prevV = Number(cAny.__timelineSearchSuggestKeysVersion ?? -1);
				const prevKeys = cAny.__timelineSearchSuggestDateKeys as string[] | null | undefined;
				if (prevV === indexVersion && Array.isArray(prevKeys)) {
					keys = prevKeys;
				}
			} catch {
				keys = null;
			}
			if (!keys) {
				keys = Object.keys(index).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
				keys.sort();
				try {
					cAny.__timelineSearchSuggestKeysVersion = indexVersion;
					cAny.__timelineSearchSuggestDateKeys = keys;
				} catch {
					// ignore
				}
			}
			for (let i = keys.length - 1; i >= 0; i--) {
				if (out.length >= limit) break;
				const dateKey = keys[i] ?? "";
				if (parsed?.dateRange && (dateKey < parsed.dateRange.start || dateKey > parsed.dateRange.end)) {
					continue;
				}
				const dt = dateKeyToDate(dateKey);
				if (!dt) continue;
				let entries: DateEntry[] = [];
				try {
					entries = getEntriesForDate(queryCanvas as any, dt, currentEpochBucket ? { epochBucket: currentEpochBucket } : {}) as any;
				} catch {
					entries = [];
				}
				for (const e of entries) {
					if (out.length >= limit) break;
					const fp = String((e as any)?.file ?? "");
					if (!fp) continue;
					if (excludeFiles.has(fp)) continue;
					excludeFiles.add(fp);
					const label = labelForEntry(e as any, fp);
					out.push({ entry: e as any, label });
				}
			}
			return out;
		};

		const out: Array<{ entry: DateEntry; label?: string }> = [];
		const excludeFiles = new Set<string>();

		// When the input is empty, include "recent" suggestions only if they resolve to
		// real entries under the current filter set (i.e. they would also appear when
		// typing a query). This prevents showing non-searchable entities like folders.
		if (!qTrim && recentPaths.length > 0) {
			const wanted = new Set(recentPaths);
			const bestByPath = new Map<string, { priority: number; ms: number; entry: any }>();
			for (const dateKey of Object.keys(index)) {
				const rawEntries = (index as any)[dateKey];
				if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
				const dt = dateKeyToDate(dateKey);
				if (!dt) continue;
				const ms = dt.getTime();
				if (!Number.isFinite(ms)) continue;
				const byPath = new Map<string, any[]>();
				for (const entry of rawEntries) {
					const fp = String((entry as any)?.file ?? "");
					if (!fp) continue;
					if (!wanted.has(fp)) continue;
					let arr = byPath.get(fp);
					if (!arr) {
						arr = [];
						byPath.set(fp, arr);
					}
					arr.push(entry);
				}
				if (byPath.size === 0) continue;
				for (const [fp, list] of byPath) {
					let picked: any = null;
					try {
						picked = pickEntryForFile(queryCanvas as any, list as any, fp, null);
					} catch {
						picked = null;
					}
					if (!picked) continue;
					const priority = getSourcePriority((picked as any).source);
					const prev = bestByPath.get(fp);
					if (!prev || priority < prev.priority || (priority === prev.priority && ms > prev.ms)) {
						bestByPath.set(fp, { priority, ms, entry: picked });
					}
				}
			}

			for (const fp of recentPaths) {
				if (out.length >= limit) break;
				const best = bestByPath.get(fp);
				if (!best?.entry) continue;
				if (excludeFiles.has(fp)) continue;
				excludeFiles.add(fp);
				const label = labelForEntry(best.entry, fp);
				out.push({ entry: best.entry as any, label });
			}
		}

		const idx: any = (view.plugin as any)?.timelineSearchIndex;
		const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
		// Epochs are stored as internal `epoch://...` entries and are intentionally not indexed
		// into MiniSearch. In Epochs view, we still want to surface normal-view matches (from
		// MiniSearch) *as well as* epoch entries (via scanning the current bucket).
		if (idx && typeof idx.searchFileIdsRanked === "function" && hasAnySearch) {
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
					if (rankedPaths.length >= Math.max(limit * 20, 50)) break;
				}
			}

			if (rankedPaths.length > 0) {
				const bestByPath = new Map<string, { priority: number; ms: number; entry: any }>();
				const wanted = new Set(rankedPaths);
				for (const dateKey of Object.keys(index)) {
					if (parsed?.dateRange && (dateKey < parsed.dateRange.start || dateKey > parsed.dateRange.end)) {
						continue;
					}
					const rawEntries = (index as any)[dateKey];
					if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
					const dt = dateKeyToDate(dateKey);
					if (!dt) continue;
					const ms = dt.getTime();
					if (!Number.isFinite(ms)) continue;
					const byPath = new Map<string, any[]>();
					for (const entry of rawEntries) {
						const fp = String((entry as any)?.file ?? "");
						if (!fp) continue;
						if (!wanted.has(fp)) continue;
						let arr = byPath.get(fp);
						if (!arr) {
							arr = [];
							byPath.set(fp, arr);
						}
						arr.push(entry);
					}
					if (byPath.size === 0) continue;
					for (const [fp, list] of byPath) {
						let picked: any = null;
						try {
							picked = pickEntryForFile(queryCanvas as any, list as any, fp, null);
						} catch {
							picked = null;
						}
						if (!picked) continue;
						const priority = getSourcePriority((picked as any).source);
						const prev = bestByPath.get(fp);
						if (!prev || priority < prev.priority || (priority === prev.priority && ms > prev.ms)) {
							bestByPath.set(fp, { priority, ms, entry: picked });
						}
					}
				}

				for (const path of rankedPaths) {
					if (out.length >= limit) break;
					const best = bestByPath.get(path);
					if (!best?.entry) continue;
					if (excludeFiles.has(path)) continue;
					excludeFiles.add(path);
					const label = labelForEntry(best.entry, path);
					out.push({ entry: best.entry as any, label });
				}
			}
		}

		// Fallback: entry-field-only matches (summaries/AI summaries/topics/tags/aliases).
		if (out.length < limit) {
			out.push(...scanMostRecentMatches(excludeFiles));
		}
		return out.slice(0, limit);
	};
	const modal = new TimelineSearchModal(view.app as any, {
		initial: view.searchQuery,
		getTopMatches,
		onCommit: (value) => {
			// Apply only on explicit user actions (Alt+Enter or selecting the current-input suggestion).
			try {
				view.setSearchQueryInternal(String(value || ""));
			} catch {
				// ignore
			}
		},
		onChooseRecord: (entry: DateEntry, query: string) => {
			const e: any = entry as any;
			const filePath = String(e?.file ?? "");
			if (!filePath) return;
			pushLastOpenedFromSearch(filePath);
			const q = String(query || "");
			void q;
			// Scroll to the chosen record (don't snap the canvas).
			try {
				(view.canvas as any).__suppressExternalAutoScrollUntil = performance.now() + 1500;
				(view.canvas as any).suppressNextFocusScrollForPath?.(filePath);
			} catch {
				// ignore
			}
			try {
				const line = Math.max(0, Number(e?.blockStart ?? 0));
				view.canvas?.focusFilteredTimelineRecordForFile?.(filePath);
				view.canvas?.setActiveFile?.(filePath, Number.isFinite(line) ? line : null, { suppressFocus: true });
			} catch {
				// ignore
			}
			try {
				void openEntryAction(view.canvas, entry as any, undefined, true);
			} catch {
				// ignore
			}
		}
	});
	const prevOnClose = (modal as any).onClose?.bind(modal);
	(modal as any).onClose = () => {
		try {
			try {
				(view.canvas as any).__suppressExternalAutoScrollUntil = performance.now() + 1000;
				const activePath = view.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
				(view.canvas as any).suppressNextFocusScrollForPath?.(activePath);
			} catch {
				// ignore
			}
			prevOnClose?.();
		} finally {
			view.searchModalOpen = false;
		}
	};
	modal.open();
}
