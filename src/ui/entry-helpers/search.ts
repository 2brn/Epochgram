import { canonicalizeTopicTerm, isNoTopicSentinel, parseTopicTerm } from "utils";
import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { getEpochRangeFromEntry } from "../epoch-canvas-utils";
import type { TimelineQuery } from "../timeline-search";
import { buildMiniSearchQueryParts } from "./search-parts";
import {
	dateKeyToUtcMs,
	getInheritedMarkComputedAt,
	getInheritedMarkIndexByPath,
	getParsedTimelineQuery,
	getSimilarScopeSignature,
	hasHiddenOnlyToken,
	hasSimilarOnlyToken,
	isColorMarked
} from "./shared";
import { getEffectiveZeroShotMinScore, isSummarizeAIEffective } from "../../plugin/pro-feature-state";
import { isTopicSimilarityEnabled } from "../../plugin/similarity/config";

function getSearchHaystackForEpochEntry(entry: DateEntry): string {
	const parts: string[] = [];

	const summary = String((entry as any)?.summary || "");
	if (summary) parts.push(summary);
	const aiSummary = String((entry as any)?.aiSummary || "");
	if (aiSummary) parts.push(aiSummary);

	const epochBucket = String((entry as any)?.epochBucket || "");
	if (epochBucket) parts.push(epochBucket);
	const epochStart = String((entry as any)?.epochStart || "");
	const epochEnd = String((entry as any)?.epochEnd || "");
	if (epochStart || epochEnd) parts.push(epochStart + " " + epochEnd);

	const markColor = Number((entry as any)?.markColor ?? NaN);
	if (Number.isFinite(markColor)) parts.push("mark:" + String(Math.floor(markColor)));
	if ((entry as any)?.pinned === true) parts.push("pinned");

	return parts.join("\n");
}

function normalizeTextForIncludes(text: string): string {
	const s = String(text || "");
	const d = (() => {
		try {
			return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
		} catch {
			return s.replace(/[\u0300-\u036f]/g, "");
		}
	})();
	return d
		.toLowerCase()
		.replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function hasMarkedOnlyToken(parsed: TimelineQuery): boolean {
	try {
		const tokens = String(parsed?.fuzzyText || "")
			.split(/\s+/g)
			.map((t) => String(t || "").trim().toLowerCase())
			.filter(Boolean);
		return tokens.includes("!marked") || tokens.includes("$marked");
	} catch {
		return false;
	}
}

export function matchesEpochEntrySearch(canvas: EpochCanvas, entry: DateEntry, parsed: TimelineQuery): boolean {
	if (parsed?.invalid === true) return false;
	if (hasSimilarOnlyToken(parsed)) return false;
	if (hasHiddenOnlyToken(parsed)) return false;
	const markedOnly = hasMarkedOnlyToken(parsed);
	if (markedOnly) {
		const inherited = getInheritedMarkIndexByPath(canvas);
		if (!isColorMarked(entry, inherited)) return false;
	}
	// Keep date-token support (YYYY-MM-DD) for epoch range searching.
	try {
		const textForDateTokens = [String(parsed.fuzzyText || ""), ...(parsed.exactPhrases ?? [])].join(" ");
		const tokens = textForDateTokens.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
		if (tokens.length > 0) {
			const uniq = Array.from(new Set(tokens));
			const range = getEpochRangeFromEntry(entry);
			if (range) {
				const startMs = dateKeyToUtcMs(range.start);
				const endMs = dateKeyToUtcMs(range.end);
				if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
					const lo = Math.min(startMs, endMs);
					const hi = Math.max(startMs, endMs);
					for (const t of uniq) {
						const ms = dateKeyToUtcMs(t);
						if (Number.isFinite(ms) && ms >= lo && ms <= hi) return true;
					}
				}
			}
		}
	} catch {
		// ignore
	}

	// Important: do NOT include the internal `epoch://...` filename in search; it
	// causes misleading matches for queries like "epoch".
	void canvas;
	const hay = normalizeTextForIncludes(getSearchHaystackForEpochEntry(entry));
	if (!hay) return false;

	// Exact phrase(s): all quoted phrases must be present.
	try {
		for (const p of parsed?.exactPhrases ?? []) {
			const needle = normalizeTextForIncludes(p);
			if (!needle) continue;
			if (!hay.includes(needle)) return false;
		}
	} catch {
		// ignore
	}

	// Excluded phrase(s): none may be present.
	try {
		for (const p of parsed?.excludedPhrases ?? []) {
			const needle = normalizeTextForIncludes(p);
			if (!needle) continue;
			if (hay.includes(needle)) return false;
		}
	} catch {
		// ignore
	}

	const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
	if (!hasAnySearch) return true;

	for (const ex of excludeTokens) {
		const needle = normalizeTextForIncludes(ex);
		if (needle && hay.includes(needle)) return false;
	}

	for (const p of exactPhrases) {
		const needle = normalizeTextForIncludes(p);
		if (needle && !hay.includes(needle)) return false;
	}
	for (const p of excludedPhrases) {
		const needle = normalizeTextForIncludes(p);
		if (needle && hay.includes(needle)) return false;
	}
	const includeTokens = includeText.split(/\s+/g).map((t) => normalizeTextForIncludes(t)).filter(Boolean);
	for (const t of includeTokens) {
		if (!hay.includes(t)) return false;
	}

	return true;
}

function getSearchHaystackForEntry(canvas: EpochCanvas, entry: DateEntry): string {
	const parts: string[] = [];
	const cAny: any = canvas as any;
	const pluginAny: any = (canvas as any)?.plugin;
	const allowAiSummary = (() => {
		try {
			if (String((entry as any)?.file ?? "").startsWith("epoch://")) return true;
			if (pluginAny && isSummarizeAIEffective(pluginAny)) return true;
		} catch {
			// ignore
		}
		return (entry as any)?.aiSummaryVisible === true;
	})();
	const file = String(entry.file || "");
	if (file) parts.push(file);
	const date = String(entry.date || "");
	if (date) parts.push(date);
	const originalDate = String(entry.originalDate || "");
	if (originalDate) parts.push(originalDate);
	const trackedTime = String(entry.trackedTime || "");
	if (trackedTime) parts.push(trackedTime);
	const summary = String(entry.summary || "");
	if (summary) parts.push(summary);
	if (allowAiSummary) {
		const aiSummary = String(entry.aiSummary || "");
		if (aiSummary) parts.push(aiSummary);
	}
	const source = String(entry.source || "");
	if (source) parts.push(source);
	const epochBucket = String(entry.epochBucket || "");
	if (epochBucket) parts.push(epochBucket);
	const epochStart = String(entry.epochStart || "");
	const epochEnd = String(entry.epochEnd || "");
	if (epochStart || epochEnd) parts.push(epochStart + " " + epochEnd);
	const reviewState = String(entry.reviewState || "");
	if (reviewState) parts.push(reviewState);
	const trackedChange = String(entry.trackedChange || "");
	if (trackedChange) parts.push(trackedChange);
	const markColor = Number(entry.markColor ?? NaN);
	if (Number.isFinite(markColor)) parts.push("mark:" + String(Math.floor(markColor)));
	if (entry.pinned === true) parts.push("pinned");

	const addTopicTerm = (raw: string) => {
		const canon = canonicalizeTopicTerm(String(raw || "").trim());
		if (!canon) return;
		if (isNoTopicSentinel(canon)) return;
		parts.push(canon);
		try {
			const parsed = parseTopicTerm(canon);
			if (parsed.kind !== "none" && parsed.kind !== "no-topic" && parsed.name) {
				parts.push(parsed.name);
			}
		} catch {
			// ignore
		}
	};

	// Topics/terms: include explicit file topic and inferred (term-similarity) topic.
	try {
		const pluginAny: any = (canvas as any)?.plugin;
		const indexer = pluginAny?.indexer;
		const getTerm = indexer?.getFileEmbeddingTerm;
		if (typeof getTerm === "function" && file) {
			const term = String(getTerm.call(indexer, file) || "").trim();
			if (term) addTopicTerm(term);
		}
		const zeroShotMin = pluginAny ? getEffectiveZeroShotMinScore(pluginAny) : 0;
		const storeLoaded = pluginAny?.termSimilarityLoaded === true && !!pluginAny?.termSimilarityIndex && typeof pluginAny.termSimilarityIndex === "object";
		if (pluginAny && isTopicSimilarityEnabled(pluginAny) && storeLoaded && zeroShotMin > 0 && zeroShotMin < 1 && file) {
			const rec: any = pluginAny?.termSimilarityIndex?.files?.[file];
			const inferred = typeof rec?.term === "string" ? String(rec.term).trim() : "";
			const score = Number(rec?.score ?? 0);
			if (inferred && Number.isFinite(score) && score >= zeroShotMin) {
				addTopicTerm(inferred);
			}
		}
	} catch {
		// ignore
	}

	// Obsidian tags + aliases (from metadata cache). Cached per-canvas per-file.
	try {
		const pluginAny: any = (canvas as any)?.plugin;
		const app: any = pluginAny?.app;
		const vault: any = app?.vault;
		const mc: any = app?.metadataCache;
		const getAbstract = vault?.getAbstractFileByPath;
		const getCache = mc?.getFileCache;
		if (typeof getAbstract === "function" && typeof getCache === "function" && file) {
			const version = Number(cAny.__indexVersion) || 0;
			const prevV = Number(cAny.__timelineSearchMetaCacheVersion) || 0;
			if (prevV !== version) {
				cAny.__timelineSearchMetaCacheVersion = version;
				cAny.__timelineSearchMetaByPath = new Map();
			}
			let map = cAny.__timelineSearchMetaByPath as Map<string, { tags: string[]; aliases: string[] }> | null | undefined;
			if (!map || typeof (map as any).get !== "function") {
				map = new Map();
				cAny.__timelineSearchMetaByPath = map;
			}
			let meta = map.get(file);
			if (!meta) {
				const normalizeTag = (raw: unknown): string => {
					const t = (typeof raw === "string")
						? raw
						: (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint")
							? String(raw)
							: "";
					const normalized = t.trim().toLowerCase();
					if (!normalized) return "";
					return normalized.startsWith("#") ? normalized.slice(1) : normalized;
				};
				const addAlias = (out: string[], raw: unknown) => {
					const s = (typeof raw === "string")
						? raw
						: (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint")
							? String(raw)
							: "";
					const normalized = s.trim();
					if (!normalized) return;
					out.push(normalized);
				};
				const tagsOut: string[] = [];
				const aliasesOut: string[] = [];
				try {
					const af = getAbstract.call(vault, file);
					const cache = af ? getCache.call(mc, af) : null;
					const tagSet = new Set<string>();
					const cacheTags = cache?.tags;
					if (Array.isArray(cacheTags)) {
						for (const t of cacheTags) {
							const norm = normalizeTag((t as any)?.tag ?? t);
							if (norm) tagSet.add(norm);
						}
					}
					const fm = cache?.frontmatter;
					const fmTags = fm?.tags;
					if (typeof fmTags === "string") {
						for (const seg of fmTags.split(/[\s,]+/g)) {
							const norm = normalizeTag(seg);
							if (norm) tagSet.add(norm);
						}
					} else if (Array.isArray(fmTags)) {
						for (const seg of fmTags) {
							const norm = normalizeTag(seg);
							if (norm) tagSet.add(norm);
						}
					}
					for (const t of tagSet) {
						tagsOut.push(`#${t}`);
						tagsOut.push(t);
					}

					const fmAliases = fm?.aliases;
					if (typeof fmAliases === "string") {
						const s = fmAliases.trim();
						if (s.includes(",") || s.includes(";") ) {
							for (const seg of s.split(/[,;]+/g)) addAlias(aliasesOut, seg);
						} else {
							addAlias(aliasesOut, s);
						}
					} else if (Array.isArray(fmAliases)) {
						for (const seg of fmAliases) addAlias(aliasesOut, seg);
					}
				} catch {
					// ignore
				}
				meta = {
					tags: Array.from(new Set(tagsOut)),
					aliases: Array.from(new Set(aliasesOut))
				};
				map.set(file, meta);
			}
			for (const t of meta.tags) parts.push(t);
			for (const a of meta.aliases) parts.push(a);
		}
	} catch {
		// ignore
	}

	return parts.join("\n");
}

function matchesFileMiniSearch(canvas: EpochCanvas, filePath: string, parsed: TimelineQuery): boolean {
	const file = String(filePath || "");
	if (!file) return false;

	const cAny: any = canvas as any;
	const sig = String(parsed?.raw || "").trim().toLowerCase();
	const pluginAny: any = (canvas as any)?.plugin;
	const idxVersion = (() => {
		try {
			const n = Number(pluginAny?.__timelineSearchIndexVersion ?? 0);
			return Number.isFinite(n) ? n : 0;
		} catch {
			return 0;
		}
	})();
	const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
	if (!hasAnySearch) return true;

	try {
		const prevSig = String(cAny.__timelineSearchMiniSig ?? "");
		const prevVersion = Number(cAny.__timelineSearchMiniVersion ?? -1);
		if (prevSig !== sig || prevVersion !== idxVersion) {
			cAny.__timelineSearchMiniSig = sig;
			cAny.__timelineSearchMiniVersion = idxVersion;
			cAny.__timelineSearchMiniMatches = null;
		}
	} catch {
		// ignore
	}

	let set: Set<string> | null = null;
	try {
		set = cAny.__timelineSearchMiniMatches as Set<string> | null;
	} catch {
		set = null;
	}
	if (!(set instanceof Set)) {
		try {
			const idx: any = pluginAny?.timelineSearchIndex;
			if (idx && typeof idx.searchFileIds === "function") {
				set = idx.searchFileIds({ includeText, excludeTokens, exactPhrases, excludedPhrases });
			} else {
				set = new Set();
			}
		} catch {
			set = new Set();
		}
		try {
			cAny.__timelineSearchMiniMatches = set;
		} catch {
			// ignore
		}
	}

	return set instanceof Set ? set.has(file) : false;
}

export function matchesSearch(canvas: EpochCanvas, entry: DateEntry): boolean {
	const parsed = getParsedTimelineQuery(canvas);
	if (parsed?.invalid === true) return false;
	const baseSig = String(parsed?.raw || "").trim().toLowerCase();
	if (!baseSig) return true;
	const markedOnly = hasMarkedOnlyToken(parsed);
	const inheritedSig = markedOnly ? String(getInheritedMarkComputedAt(canvas) || 0) : "";
	const similarScopeSig = getSimilarScopeSignature(canvas, parsed);
	const sigParts = [baseSig];
	if (markedOnly) sigParts.push(`IM:${inheritedSig}`);
	if (similarScopeSig) sigParts.push(similarScopeSig);
	const sig = sigParts.join("|");

	const cAny: any = canvas as any;
	const pluginAny: any = (canvas as any)?.plugin;
	const idxVersion = (() => {
		try {
			const n = Number(pluginAny?.__timelineSearchIndexVersion ?? 0);
			return Number.isFinite(n) ? n : 0;
		} catch {
			return 0;
		}
	})();
	try {
		const prevSig = String(cAny.__timelineSearchSig ?? "");
		const prevVersion = Number(cAny.__timelineSearchVersion ?? -1);
		if (prevSig !== sig || prevVersion !== idxVersion) {
			cAny.__timelineSearchSig = sig;
			cAny.__timelineSearchVersion = idxVersion;
			cAny.__timelineSearchMatchCache = new WeakMap();
		}
	} catch {
		// ignore
	}

	let cache: WeakMap<object, boolean> | null = null;
	try {
		cache = cAny.__timelineSearchMatchCache as WeakMap<object, boolean> | null;
	} catch {
		cache = null;
	}
	if (!(cache instanceof WeakMap)) {
		cache = new WeakMap();
		try {
			cAny.__timelineSearchMatchCache = cache;
		} catch {
			// ignore
		}
	}

	try {
		const prev = cache.get(entry as any);
		if (typeof prev === "boolean") return prev;
	} catch {
		// ignore
	}

	let result = false;
	const filePath = String((entry as any)?.file || "");

	if (markedOnly) {
		try {
			const inherited = getInheritedMarkIndexByPath(canvas);
			if (!isColorMarked(entry, inherited)) {
				try {
					cache.set(entry as any, false);
				} catch {
					// ignore
				}
				return false;
			}
		} catch {
			// ignore
		}
	}

	if (hasSimilarOnlyToken(parsed)) {
		const related = new Set<string>();
		const activePath = (() => {
			try {
				const c: any = canvas as any;
				const raw = String(c?.semanticRelatedBasePath ?? c?.activeFilePath ?? "").trim();
				if (!raw || raw.startsWith("epoch://")) return "";
				return raw;
			} catch {
				return "";
			}
		})();
		if (activePath) related.add(activePath);
		try {
			const p = (canvas as any)?.semanticRelatedPaths;
			if (p instanceof Set) {
				for (const item of p) {
					const next = String(item || "").trim();
					if (next) related.add(next);
				}
			}
		} catch {
			// ignore
		}
		try {
			const p = (canvas as any)?.semanticRelatedTermPaths;
			if (p instanceof Set) {
				for (const item of p) {
					const next = String(item || "").trim();
					if (next) related.add(next);
				}
			}
		} catch {
			// ignore
		}
		if (activePath && related.size > 0 && !related.has(filePath)) {
			try {
				cache.set(entry as any, false);
			} catch {
				// ignore
			}
			return false;
		}
	}

	const hasMini = !!pluginAny?.timelineSearchIndex && typeof pluginAny.timelineSearchIndex.searchFileIds === "function";
	const haystackMatch = () => {
		const hay = normalizeTextForIncludes(getSearchHaystackForEntry(canvas, entry));
		if (!hay) return false;
		const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
		if (!hasAnySearch) return true;

		for (const ex of excludeTokens) {
			const needle = normalizeTextForIncludes(ex);
			if (needle && hay.includes(needle)) return false;
		}
		for (const p of excludedPhrases) {
			const needle = normalizeTextForIncludes(p);
			if (needle && hay.includes(needle)) return false;
		}
		try {
			for (const p of (parsed?.exactPhrases ?? [])) {
				const needle = normalizeTextForIncludes(p);
				if (needle && !hay.includes(needle)) {
					return false;
				}
			}
		} catch {
			// ignore
		}
		for (const p of exactPhrases) {
			const needle = normalizeTextForIncludes(p);
			if (needle && !hay.includes(needle)) return false;
		}

		const includeTokens = includeText.split(/\s+/g).map((t) => normalizeTextForIncludes(t)).filter(Boolean);
		for (const t of includeTokens) {
			if (!hay.includes(t)) return false;
		}
		return true;
	};

	if (hasMini) {
		// First try MiniSearch (fast full-text / file meta). If it doesn't match,
		// fall back to entry-level fields (summary/AI summary/tags/aliases/topics/etc).
		result = matchesFileMiniSearch(canvas, filePath, parsed) || haystackMatch();
	} else {
		result = haystackMatch();
	}

	try {
		cache.set(entry as any, result);
	} catch {
		// ignore
	}
	return result;
}
