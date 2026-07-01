import type { App } from "obsidian";
import type { DateEntry, EpochBucket } from "../../indexer/types";

import { TimelineSearchModal } from "../modals/timeline-search-modal";
import type { EpochCanvas } from "../epoch-canvas";
import { openEntry as openEntryAction } from "../epoch-canvas-actions";
import { getEntryTitle } from "../epoch-canvas-helpers";
import { SUMMARY_SEPARATOR_SYMBOL } from "../epoch-canvas-constants";
import { dateKeyToDate, getSourcePriority } from "../epoch-canvas-focus";
import { entryFileName, formatEntrySummary, getEpochRangeFromEntry } from "../epoch-canvas-utils";
import { buildMiniSearchQueryParts } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";
import { matchesSearch } from "../entry-helpers/search";

type SearchWorkspaceLike = {
	getActiveFile?: () => { path?: string } | null;
	getLastOpenFiles?: () => unknown[];
};

type SearchAppLike = App & {
	workspace: SearchWorkspaceLike;
};

type SearchPluginLike = {
	app?: SearchAppLike;
	settings: {
		searchResultsLimit: number;
		filenameWordsCount: number;
		summaryWordsCount: number;
	};
	__timelineSearchLastOpenedFiles?: string[];
	timelineSearchIndex?: {
		searchFileIdsRanked?: (options: {
			includeText: string;
			excludeTokens: string[];
			exactPhrases: string[];
			excludedPhrases: string[];
		}) => unknown[];
	};
};

type SearchCanvasLike = {
	index?: Record<string, DateEntry[]>;
	epochsView?: boolean;
	epochsViewBucket?: EpochBucket | null;
	__indexVersion?: number;
	__timelineSearchSuggestKeysVersion?: number;
	__timelineSearchSuggestDateKeys?: string[];
	__suppressExternalAutoScrollUntil?: number;
	suppressNextFocusScrollForPath?: (path: string | null) => void;
	focusFilteredTimelineRecordForFile?: (path: string) => void;
	setActiveFile?: (path: string, line: number | null, options: { suppressFocus: boolean }) => void;
};

type SearchViewLike = {
	app: SearchAppLike;
	canvas: SearchCanvasLike;
	plugin: SearchPluginLike;
	searchModalOpen: boolean;
	searchQuery: string;
	setSearchQueryInternal(value: string): void;
};

export function openSearchModal(view: SearchViewLike): void {
	if (view.searchModalOpen) return;
	// Avoid jumping the canvas to the currently-open note when this modal opens/closes.
	// This can happen because active file regains focus after SuggestModal resolves.
	try {
		const now = window.performance?.now?.() ?? Date.now();
		view.canvas.__suppressExternalAutoScrollUntil = now + 1000;
		const activePath = view.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
		view.canvas.suppressNextFocusScrollForPath?.(activePath);
	} catch {
		// ignore
	}
	view.searchModalOpen = true;

	const pushLastOpenedFromSearch = (filePath: string) => {
		const p = String(filePath || "");
		if (!p) return;
		try {
			const prev = view.plugin.__timelineSearchLastOpenedFiles;
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
			view.plugin.__timelineSearchLastOpenedFiles = out;
		} catch {
			// ignore
		}
	};

	const getTopMatches = (raw: string, max: number): Array<{ entry: DateEntry; label?: string }> => {
		const q = String(raw || "");
		const qTrim = q.trim();
		const limit = Math.max(0, Math.floor(max || 0));
		if (limit <= 0) return [];

		const parsed = parseTimelineQuery(q);
		const canvas = view.canvas;
		const index = canvas.index ?? null;
		if (!index || typeof index !== "object") return [];

		const labelForEntry = (entry: DateEntry, fallbackPath: string): string => {
			try {
				const isEpoch = String(entry.file ?? "").startsWith("epoch://");
				if (isEpoch) {
					const r = getEpochRangeFromEntry(entry);
					if (r?.start && r?.end) {
						const summary = String(entry.summary ?? "").trim();
						const aiSummary = String(entry.aiSummary ?? "").trim();
						const text = summary || aiSummary;
						return text ? `${r.start} - ${r.end} ${SUMMARY_SEPARATOR_SYMBOL} ${text}` : `${r.start} - ${r.end}`;
					}
				}
				const rawTitle = getEntryTitle(canvas as unknown as EpochCanvas, entry) || entryFileName(entry);
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
						summaryWordsCount: view.plugin.settings.summaryWordsCount,
					}) || "").trim();
				const isFallbackSummary = displaySummary === title;
				const effectiveSummary = isFallbackSummary ? "" : displaySummary;
				return (effectiveSummary.length > 0 ? effectiveSummary : title) || fallbackPath;
			} catch {
				return fallbackPath;
			}
		};

		const getSortedDateKeys = (): string[] => {
			const cAny = canvas;
			const indexVersion = (() => {
				try {
					const n = Number(cAny?.__indexVersion ?? 0);
					return Number.isFinite(n) ? n : 0;
				} catch {
					return 0;
				}
			})();
			try {
				const prevV = Number(cAny.__timelineSearchSuggestKeysVersion ?? -1);
				const prevKeys = cAny.__timelineSearchSuggestDateKeys;
				if (prevV === indexVersion && Array.isArray(prevKeys)) {
					return prevKeys;
				}
			} catch {
				// ignore
			}
			const keys = Object.keys(index).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
			keys.sort();
			try {
				cAny.__timelineSearchSuggestKeysVersion = indexVersion;
				cAny.__timelineSearchSuggestDateKeys = keys;
			} catch {
				// ignore
			}
			return keys;
		};

		const pickBestByPaths = (paths: string[]): Map<string, { priority: number; ms: number; entry: DateEntry }> => {
			const wanted = new Set(paths);
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
				for (const entry of rawEntries) {
					const fp = String(entry?.file ?? "");
					if (!fp) continue;
					if (!wanted.has(fp)) continue;
					const priority = getSourcePriority(entry.source);
					const prev = bestByPath.get(fp);
					if (!prev || priority < prev.priority || (priority === prev.priority && ms > prev.ms)) {
						bestByPath.set(fp, { priority, ms, entry });
					}
				}
			}
			return bestByPath;
		};

		const collectRecentPaths = (): string[] => {
			const out: string[] = [];
			const seen = new Set<string>();

			try {
				for (const pRaw of Array.isArray(view.plugin.__timelineSearchLastOpenedFiles) ? view.plugin.__timelineSearchLastOpenedFiles : []) {
					const p = String(pRaw || "");
					if (!p || seen.has(p)) continue;
					seen.add(p);
					out.push(p);
				}
			} catch {
				// ignore
			}

			try {
				const activePath = String(view.plugin.app?.workspace?.getActiveFile?.()?.path ?? "");
				if (activePath && !seen.has(activePath)) {
					seen.add(activePath);
					out.push(activePath);
				}
			} catch {
				// ignore
			}

			try {
				const last = view.app.workspace.getLastOpenFiles?.();
				for (const pRaw of Array.isArray(last) ? last : []) {
					const p = String(pRaw || "");
					if (!p || seen.has(p)) continue;
					seen.add(p);
					out.push(p);
				}
			} catch {
				// ignore
			}

			return out;
		};

		const out: Array<{ entry: DateEntry; label?: string }> = [];
		const excludeFiles = new Set<string>();
		const queryCanvas = ({
			...(canvas as unknown as Record<string, unknown>),
			searchQuery: q,
		} as unknown) as EpochCanvas;
		const hiddenOnly = (() => {
			try {
				const toks = String(parsed?.fuzzyText || "")
					.split(/\s+/g)
					.map((t) => String(t || "").trim().toLowerCase())
					.filter(Boolean);
				return toks.includes("!hidden") || toks.includes("$hidden");
			} catch {
				return false;
			}
		})();

		const pushPathBucket = (paths: string[]): void => {
			if (paths.length === 0) return;
			const bestByPath = pickBestByPaths(paths);
			for (const fp of paths) {
				if (out.length >= limit) break;
				if (excludeFiles.has(fp)) continue;
				const best = bestByPath.get(fp);
				if (!best?.entry) continue;
				excludeFiles.add(fp);
				out.push({ entry: best.entry, label: labelForEntry(best.entry, fp) });
			}
		};

		const pushRecentByMdateBucket = (): void => {
			const keys = getSortedDateKeys();
			for (let i = keys.length - 1; i >= 0; i--) {
				if (out.length >= limit) break;
				const dateKey = keys[i] ?? "";
				if (parsed?.dateRange && (dateKey < parsed.dateRange.start || dateKey > parsed.dateRange.end)) {
					continue;
				}
				const rawEntries = index[dateKey];
				if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
				const ordered = rawEntries
					.filter((e) => !!e)
					.slice()
					.sort((a, b) => getSourcePriority(a.source) - getSourcePriority(b.source));
				for (const e of ordered) {
					if (out.length >= limit) break;
					const fp = String(e.file ?? "");
					if (!fp) continue;
					if (excludeFiles.has(fp)) continue;
					excludeFiles.add(fp);
					out.push({ entry: e, label: labelForEntry(e, fp) });
				}
			}
		};

		const pushQueryMatchedEntriesBucket = (): void => {
			if (!qTrim || out.length >= limit) return;
			const keys = getSortedDateKeys();
			for (let i = keys.length - 1; i >= 0; i--) {
				if (out.length >= limit) break;
				const dateKey = keys[i] ?? "";
				if (parsed?.dateRange && (dateKey < parsed.dateRange.start || dateKey > parsed.dateRange.end)) {
					continue;
				}
				const rawEntries = index[dateKey];
				if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
				const ordered = rawEntries
					.filter((e) => !!e)
					.slice()
					.sort((a, b) => getSourcePriority(a.source) - getSourcePriority(b.source));
				for (const e of ordered) {
					if (out.length >= limit) break;
					const fp = String(e.file ?? "");
					if (!fp) continue;
					if (excludeFiles.has(fp)) continue;
					if (hiddenOnly && e.reviewState !== "hidden") continue;
					let ok = false;
					try {
						ok = matchesSearch(queryCanvas, e) === true;
					} catch {
						ok = false;
					}
					if (!ok) continue;
					excludeFiles.add(fp);
					out.push({ entry: e, label: labelForEntry(e, fp) });
				}
			}
		};

		// Bucket A (non-empty only): MiniSearch ranked paths.
		const idx = view.plugin.timelineSearchIndex;
		const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
		if (qTrim && out.length < limit && idx && typeof idx.searchFileIdsRanked === "function" && hasAnySearch) {
			let ranked: unknown[] = [];
			try {
				ranked = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases }) ?? [];
			} catch {
				ranked = [];
			}
			const rankedPaths: string[] = [];
			const seen = new Set<string>();
			for (const fpRaw of Array.isArray(ranked) ? ranked : []) {
				const p = typeof fpRaw === "string" ? fpRaw : "";
				if (!p || seen.has(p)) continue;
				seen.add(p);
				rankedPaths.push(p);
				if (rankedPaths.length >= Math.max(limit * 20, 50)) break;
			}
			pushPathBucket(rankedPaths);
		}

		// Non-empty fallback: if MiniSearch ranked results are empty (e.g. token-only queries
		// like "$hidden" / "$marked"), use query-matched entry scanning across all files.
		if (qTrim && out.length < limit) {
			pushQueryMatchedEntriesBucket();
		}

		if (!qTrim) {
			const recentPaths = collectRecentPaths();
			// Empty query buckets: history -> active -> last-open (all files, no timeline filter gating).
			pushPathBucket(recentPaths);

			// Empty query fallback: mdate/recent records.
			if (out.length < limit) pushRecentByMdateBucket();
		}

		return out.slice(0, limit);
	};

	const modal = new TimelineSearchModal(view.app, {
		initial: view.searchQuery,
		maxSuggestions: Math.max(1, Math.min(50, Math.floor(Number(view.plugin?.settings?.searchResultsLimit ?? 7) || 7))),
		getTopMatches,
		onCommit: (value) => {
			// Apply only on explicit user actions (Alt+Enter or selecting the current-input suggestion).
			try {
				view.setSearchQueryInternal(String(value || ""));
			} catch {
				// ignore
			}
		},
		onChooseRecord: (entry: DateEntry, query: string, ev?: MouseEvent | KeyboardEvent) => {
			const filePath = String(entry.file ?? "");
			if (!filePath) return;
			pushLastOpenedFromSearch(filePath);
			const q = String(query || "");
			void q;
			// Scroll to the chosen record (don't snap the canvas).
			try {
				const now = window.performance?.now?.() ?? Date.now();
				view.canvas.__suppressExternalAutoScrollUntil = now + 1500;
				view.canvas.suppressNextFocusScrollForPath?.(filePath);
			} catch {
				// ignore
			}
			try {
				const line = Math.max(0, Number(entry.blockStart ?? 0));
				view.canvas.focusFilteredTimelineRecordForFile?.(filePath);
				view.canvas.setActiveFile?.(filePath, Number.isFinite(line) ? line : null, { suppressFocus: true });
			} catch {
				// ignore
			}
			try {
				const maybeEv = ev as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
				const evt = maybeEv && (maybeEv.ctrlKey || maybeEv.metaKey) ? (ev as unknown as MouseEvent) : undefined;
				void openEntryAction(view.canvas as unknown as Parameters<typeof openEntryAction>[0], entry, evt, true);
			} catch {
				// ignore
			}
		}
	});
	const modalWithClose = modal as typeof modal & { onClose?: () => void };
	const prevOnClose = modalWithClose.onClose?.bind(modalWithClose);
	modalWithClose.onClose = () => {
		try {
			try {
				const now = window.performance?.now?.() ?? Date.now();
				view.canvas.__suppressExternalAutoScrollUntil = now + 1000;
				const activePath = view.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
				view.canvas.suppressNextFocusScrollForPath?.(activePath);
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
