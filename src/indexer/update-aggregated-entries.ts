import { addEntries, removeEntriesForFile, sortIndex } from "./indexer-utils";
import { extractText, resolveSummaryForFile, stripDatesFromContentSummaryText } from "./summary-helpers";
import { formatDate } from "utils";
import { computeAiSummaryInputHash } from "utils";
import { expandRecurrenceToDateKeys } from "./recurrence";
import { extractFrontmatterDescription } from "./summarizer";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { getAiSummaryTuning } from "../plugin/ai-summaries/bridge-settings";
import { getYamlDescriptionPropertyKey, readFrontmatterProperty } from "../plugin/frontmatter-keys";
import type {
	DateEntry,
	FileDateEntry,
	ReviewState,
	RecurrenceIndexData
} from "./types";
import { isTodayPinMode } from "./types";
import type { IndexerPipeline } from "./pipeline";
import { hasRecurringAccess, isTrackChangesConfigured } from "../plugin/pro-feature-state";

type ProMethods = {
	hasRecurringAccess?: () => boolean;
	hasProAccess?: () => boolean;
	settings?: { summarizeAI?: boolean };
	app?: {
		vault?: { getAbstractFileByPath?: (path: string) => unknown };
		metadataCache?: { getFileCache?: (file: unknown) => { frontmatter?: unknown } | null };
	};
};

type PluginSettings = {
	summarizeAI?: boolean;
};

function canExpandRecurringEntries(plugin: ProMethods): boolean {
	try {
		if (typeof plugin.hasRecurringAccess === "function") {
			return plugin.hasRecurringAccess() === true;
		}
	} catch {
		// ignore
	}
	try {
		return hasRecurringAccess(plugin as unknown as Parameters<typeof hasRecurringAccess>[0]);
	} catch {
		return plugin.hasProAccess?.() === true;
	}
}

export function updateAggregatedEntriesInternal(
	s: IndexerPipeline,
	filePath: string,
	options: { skipSort?: boolean } = {}
): void {
	removeEntriesForFile(s.index, filePath);

	const data = s.files[filePath];
	if (!data) {
		if (!options.skipSort) {
			s.index = sortIndex(s.index);
		}
		return;
	}

	const normalizeReviewState = (entryState: unknown): "draft" | "reviewed" | "hidden" => {
		if (entryState === "hidden") return "hidden";
		if (entryState === "reviewed") return "reviewed";
		return "draft";
	};

	const lines = s.latestLines[filePath] ?? [];
	const suppression = (() => {
		const fromData = {
			noparsed: data.noparsed === true,
			notracked: data.notracked === true
		};
		if (fromData.noparsed || fromData.notracked) return fromData;
		return resolveFrontmatterSuppressionFlags(s.plugin, filePath);
	})();
	const pinnedFile = isTodayPinMode(data.pinnedFile);
	const canUseAiSummary = !!s.plugin?.hasProAccess?.();
	const shouldUseAiSummaryForEntry = (entry: FileDateEntry): boolean => {
		if (!canUseAiSummary) return false;
		try {
			if ((s.plugin.settings as PluginSettings | undefined)?.summarizeAI === true) return true;
		} catch {
			// ignore
		}
		return entry.aiSummaryVisible === true;
	};
	const tuning = getAiSummaryTuning(s.plugin);
	const maxInputChars = tuning.recordsMaxInputChars;
	const joinLinesUpToChars = (ls: string[], maxChars: number): string => {
		if (!ls || ls.length === 0) return "";
		if (!(maxChars > 0)) return "";
		let out = "";
		for (let i = 0; i < ls.length; i++) {
			const next = (out ? "\n" : "") + String(ls[i] ?? "");
			if (out.length + next.length > maxChars) break;
			out += next;
		}
		return out;
	};
	const fullText = lines.length > 0 ? joinLinesUpToChars(lines, maxInputChars) : "";
	const described = (() => {
		const descriptionKey = getYamlDescriptionPropertyKey(s.plugin);
		if (fullText) {
			return extractFrontmatterDescription(fullText, descriptionKey).trim();
		}
		// `latestLines` is intentionally dropped after indexing to bound memory.
		// When later re-aggregation occurs without cached file text, still prefer
		// YAML frontmatter `description` via the Obsidian metadata cache.
		try {
			const pluginState = s.plugin as ProMethods;
			const file = pluginState.app?.vault?.getAbstractFileByPath?.(filePath);
			const cache = pluginState.app?.metadataCache?.getFileCache?.(file);
			const fm: unknown = cache?.frontmatter ?? null;
			const raw = readFrontmatterProperty(fm, descriptionKey);
			const value =
				typeof raw === "string"
					? raw
					: typeof raw === "number" || typeof raw === "boolean"
						? String(raw)
						: "";
			return value.trim();
		} catch {
			return "";
		}
	})();
	const groupTypeForEntry = (entry: FileDateEntry): "anchor" | "content" | "tracked" => {
		if (entry.source === "tracked") return "tracked";
		if (entry.source === "cdate" || entry.source === "namedate" || entry.source === "dateprop") return "anchor";
		return "content";
	};
	const buildGroupInput = (entry: FileDateEntry): string => {
		const gt = groupTypeForEntry(entry);
		if (gt === "anchor") {
			return String(fullText ?? "").trim();
		}
		if (gt === "tracked") {
			const list = Array.isArray(data.trackedDates?.[entry.date]) ? data.trackedDates[entry.date] : [];
			return list.map(e => String(e.summary ?? "").trim()).filter(Boolean).join("\n");
		}
		// content
		const list = Array.isArray(data.contentDates) ? data.contentDates : [];
		return list
			.filter(e => e.date === entry.date && e.source !== "namedate")
			.map(e => extractText(lines, e.blockStart, e.blockEnd))
			.filter(Boolean)
			.join("\n\n");
	};
	const computeGroupHash = (entry: FileDateEntry, groupInput: string): string => {
		const gt = groupTypeForEntry(entry);
		const key = gt === "anchor" ? "anchor" : `${entry.date}|${gt}`;
		return computeAiSummaryInputHash(filePath, key, groupInput, maxInputChars);
	};
	const resolveGroupedAiSummaryIfValid = (entry: FileDateEntry): string | null => {
		const gt = groupTypeForEntry(entry);
		const aiSummary = typeof entry.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const storedHash = typeof entry.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash : "";
		if (!aiSummary || !storedHash) return null;
		const groupInput = buildGroupInput(entry);
		if (!groupInput) {
			// If we can't rebuild the current input (e.g., after reload when file lines aren't cached),
			// fall back to the stored AI summary rather than hiding it.
			return aiSummary;
		}
		const currentHash = computeGroupHash(entry, groupInput);
		if (currentHash === storedHash) return aiSummary;
		// Tracked-change records can drift as new tracked rows are added on the same date.
		// Anchor entries survive rename and frontmatter-date changes (drag-drop): the file
		// path or date line changes but the body content is the same. The AI is always
		// re-enqueued on modify, so the stale window is short. Show the old summary rather
		// than blinking to normal while waiting for the AI to re-run.
		return gt === "content" ? null : aiSummary;
	};

	const summarizeRange = (entry: FileDateEntry): FileDateEntry => {
		const markColor = typeof entry.markColor === "number" ? entry.markColor : undefined;
		const markColorHex = typeof entry.markColorHex === "string" && String(entry.markColorHex).trim()
			? String(entry.markColorHex).trim()
			: typeof data.markColorHex === "string" && String(data.markColorHex).trim()
				? String(data.markColorHex).trim()
				: undefined;
		const entryReviewState = normalizeReviewState(entry.reviewState);
		const base: FileDateEntry = {
			...entry,
			markColor,
			markColorHex,
			pinned: entry.pinned === true || pinnedFile
		};
		base.reviewState = entryReviewState;
		if (described) {
			base.summary = resolveSummaryForFile(s.plugin, entry.file, described, {
				includeFileName: false,
				skipFlatten: true
			});
			return base;
		}
		if (shouldUseAiSummaryForEntry(entry)) {
			const resolved = resolveGroupedAiSummaryIfValid(entry);
			if (resolved) {
				const cleaned = entry.source === "content"
					? (stripDatesFromContentSummaryText(resolved) || resolved.trim())
					: resolved;
				base.summary = resolveSummaryForFile(s.plugin, entry.file, cleaned, { includeFileName: false });
				return base;
			}
		}
		const canUseText = lines.length > 0;
		const isSummaryOff = Math.max(0, s.plugin?.settings?.summaryWordsCount ?? 0) <= 0;
		if (!canUseText) {
			// When we don't have file text (e.g., after reload), preserve the stored summary.
			// Only fall back to a cached YAML frontmatter description if there's no stored summary.
			if (isSummaryOff && entry.source === "tracked") {
				base.summary = resolveSummaryForFile(s.plugin, entry.file, "", { includeFileName: false });
				return base;
			}
			const stored = typeof entry.summary === "string" ? entry.summary.trim() : "";
			base.summary = stored || described || "";
			return base;
		}
		if (entry.source === "tracked") {
			if (isSummaryOff) {
				base.summary = resolveSummaryForFile(s.plugin, entry.file, "", { includeFileName: false });
			} else {
				base.summary = typeof entry.summary === "string" ? entry.summary : "";
			}
			return base;
		}
		const useBodySummary = entry.source === "content" && entry.fromFrontmatter === true;
		const rawText = useBodySummary ? fullText : extractText(lines, entry.blockStart, entry.blockEnd);
		const text = entry.source === "content"
			? (stripDatesFromContentSummaryText(rawText) || rawText.trim())
			: rawText;
		base.summary = resolveSummaryForFile(s.plugin, entry.file, text, { includeFileName: false });
		return base;
	};

	const resolvedContent = (data.contentDates ?? [])
		.filter(e => !(suppression.noparsed && String(e.source ?? "") === "content"))
		.map(summarizeRange);
	let resolvedTracked: FileDateEntry[] = [];
	if (isTrackChangesConfigured(s.plugin) && !suppression.notracked) {
		for (const entries of Object.values(data.trackedDates ?? {})) {
			resolvedTracked = resolvedTracked.concat(entries.map(summarizeRange));
		}
	}

	const trackedByDate: Record<string, FileDateEntry[]> = {};
	for (const entry of resolvedTracked) {
		(trackedByDate[entry.date] = trackedByDate[entry.date] || []).push(entry);
	}

	const mergedDates = s.buildMergedDates({
		...data,
		contentDates: resolvedContent,
		trackedDates: trackedByDate
	});
	const entries: DateEntry[] = [];

	const anchorSource = data.namedDate ? "namedDate" : data.dateProp ? "dateProp" : data.cdate ? "cdate" : null;
	let anchorEntry: FileDateEntry | null = null;
	if (anchorSource) {
		const sourceEntry =
			anchorSource === "namedDate"
				? data.namedDate
				: anchorSource === "dateProp"
					? data.dateProp
					: data.cdate;
		if (sourceEntry) {
			const entryReviewState = normalizeReviewState(sourceEntry.reviewState);
			let summary = sourceEntry.summary;
			let usedAiSummary = false;
			if (described) {
				summary = resolveSummaryForFile(s.plugin, filePath, described, {
					includeFileName: false,
					skipFlatten: true
				});
			} else if (shouldUseAiSummaryForEntry(sourceEntry)) {
				const resolved = resolveGroupedAiSummaryIfValid(sourceEntry);
				if (resolved) {
					usedAiSummary = true;
					summary = resolveSummaryForFile(s.plugin, filePath, resolved, { includeFileName: false });
				} else if (lines.length > 0) {
					summary = resolveSummaryForFile(s.plugin, filePath, fullText, {
						includeFileName: false,
						ignoreFrontmatterDescription: false
					});
				}
			} else if (lines.length > 0) {
				summary = resolveSummaryForFile(s.plugin, filePath, fullText, {
					includeFileName: false,
					ignoreFrontmatterDescription: false
				});
			}
			// `latestLines` is intentionally dropped after indexing to bound memory. Actions like pinning
			// can trigger re-aggregation later without file lines, so persist the computed *non-AI*
			// anchor summary back into the stored anchor entry to keep behavior stable.
			if (!usedAiSummary && lines.length > 0) {
				try {
					sourceEntry.summary = summary;
				} catch {
					// ignore
				}
			}
			anchorEntry = {
				...sourceEntry,
				summary,
				markColor: typeof sourceEntry.markColor === "number" ? sourceEntry.markColor : undefined,
				markColorHex: typeof sourceEntry.markColorHex === "string" && String(sourceEntry.markColorHex).trim()
					? String(sourceEntry.markColorHex).trim()
					: typeof data.markColorHex === "string" && String(data.markColorHex).trim()
						? String(data.markColorHex).trim()
						: undefined,
				pinned: sourceEntry.pinned === true || pinnedFile
			};
			anchorEntry.reviewState = entryReviewState;
		}
	}

	const todayKey = formatDate(s.today());
	let pinnedTodayEntry: DateEntry | null = null;
	if (anchorEntry && pinnedFile) {
		if (anchorEntry.date === todayKey) {
			anchorEntry = {
				...anchorEntry,
				pinned: true
			};
		} else {
			pinnedTodayEntry = {
				...anchorEntry,
				date: todayKey,
				originalDate: anchorEntry.date,
				pinned: true
			};
		}
	}

	// Synthetic recurring occurrences derived from YAML frontmatter.
	// These entries are treated like parsed+YAML content dates (fromFrontmatter: true),
	// but should remain virtual (not persisted to disk).
	const recurringEntries: DateEntry[] = (() => {
		if (!canExpandRecurringEntries(s.plugin as ProMethods)) return [];
		const rec: RecurrenceIndexData | null | undefined = data.recur;
		if (!rec || typeof rec !== "object") return [];
		const rule = String(rec.rrule ?? "").trim();
		const raw = String(rec.raw ?? "").trim();
		if (!rule || !raw) return [];
		const anchorKey = (() => {
			const nd = data.namedDate?.date;
			const dp = data.dateProp?.date;
			const cd = data.cdate?.date;
			return typeof nd === "string" && nd
				? nd
				: typeof dp === "string" && dp
					? dp
					: typeof cd === "string" && cd
						? cd
						: null;
		})();
		const keys = expandRecurrenceToDateKeys({ recur: rec, fallbackFromKey: anchorKey, todayKey });
		if (keys.length === 0) return [];
		const lineRaw = Number(rec.line ?? 0);
		const line = Number.isFinite(lineRaw) ? Math.max(0, Math.floor(lineRaw)) : 0;
		const lineText = (() => {
			if (!Array.isArray(lines) || lines.length === 0) return "";
			const idx = Math.max(0, Math.min(lines.length - 1, line));
			return String(lines[idx] ?? "");
		})();
		const anchorSummary = typeof anchorEntry?.summary === "string" ? anchorEntry.summary.trim() : "";
		const summaryText = described || (fullText.trim() ? fullText : "") || anchorSummary || (lineText.trim() ? lineText : `repeat: ${raw}`);
		const summary = resolveSummaryForFile(s.plugin, filePath, summaryText, { includeFileName: false });
		const hiddenSet = (() => {
			try {
				const raw = data.recurHiddenDates;
				if (!Array.isArray(raw) || raw.length === 0) return new Set<string>();
				const out = new Set<string>();
				for (const v of raw) {
					const s = String(v || "").trim();
					if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.add(s);
				}
				return out;
			} catch {
				return new Set<string>();
			}
		})();
		const reviewedSet = (() => {
			try {
				const raw = data.recurReviewedDates;
				if (!Array.isArray(raw) || raw.length === 0) return new Set<string>();
				const out = new Set<string>();
				for (const v of raw) {
					const s = String(v || "").trim();
					if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.add(s);
				}
				return out;
			} catch {
				return new Set<string>();
			}
		})();
		const markColor = typeof data.markColor === "number" ? data.markColor : undefined;
		const out: DateEntry[] = [];
		const seen = new Set<string>();
		for (const key of keys) {
			const dk = String(key || "");
			if (!dk) continue;
			if (seen.has(dk)) continue;
			seen.add(dk);
			const entryReviewState: ReviewState = hiddenSet.has(dk) ? "hidden" : reviewedSet.has(dk) ? "reviewed" : "draft";
			out.push({
				date: dk,
				file: filePath,
				blockStart: line,
				blockEnd: line,
				summary,
				source: "content",
				fromFrontmatter: true,
				recurring: true,
				reviewState: entryReviewState,
				markColor,
				markColorHex: typeof data.markColorHex === "string" && String(data.markColorHex).trim() ? String(data.markColorHex).trim() : undefined,
				pinned: pinnedFile
			});
		}
		return out;
	})();

	if (mergedDates.length === 0) {
		if (anchorEntry) entries.push(anchorEntry);
	} else {
		entries.push(...mergedDates);
		if (anchorEntry) {
			entries.push(anchorEntry);
		}
	}

	if (recurringEntries.length > 0) {
		entries.push(...recurringEntries);
	}

	if (pinnedTodayEntry) {
		pinnedTodayEntry.markColor = anchorEntry?.markColor;
		pinnedTodayEntry.reviewState = anchorEntry?.reviewState ?? "draft";
		entries.push(pinnedTodayEntry);
	}

	const fileMtimeMs = Number(data.indexedMtimeMs ?? 0);
	if (Number.isFinite(fileMtimeMs) && fileMtimeMs > 0) {
		for (const entry of entries) {
			if (!entry || typeof entry !== "object") continue;
			entry.fileMtimeMs = fileMtimeMs;
		}
	}

	addEntries(s.index, entries);
	if (!options.skipSort) {
		s.index = sortIndex(s.index);
	}
	// Inherited marks depend on the index contents (and mark colors). Compute them as part of
	// index update flow (debounced), not during timeline rendering.
	try {
		s.plugin?.scheduleInheritedMarkRecompute?.("index");
	} catch {
		// ignore
	}
}
