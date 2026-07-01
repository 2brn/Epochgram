import type { EpochPlugin } from "../main";
import { computeInheritedMarkData, type InheritedMarkData, type EpochChildRecord } from "../ui/inherited-mark";
import type { DateEntry } from "../indexer/types";
import { canonicalizeTopicTerm, isNoTopicSentinel } from "utils";
import { getDirectLinkedPaths, getSameTagPaths } from "./similarity/graph";
import { getTermVocabulary } from "./similarity/topic";
import { embeddingsSimilarityEnabled, isTopicSimilarityEnabled } from "./similarity/config";
import {
	getEffectiveSimilarityThreshold,
	getEffectiveSimilarityUseLinks,
	getEffectiveSimilarityUseTags,
	getEffectiveTitleSimilarityThreshold,
	getEffectiveZeroShotMinScore
} from "./pro-feature-state";

import {
	canMatchBySignalMask,
	getFileSimilaritySignalMask,
	SIGNAL_LINKS,
	SIGNAL_SEMANTICS,
	SIGNAL_TAGS,
	SIGNAL_TITLE,
	SIGNAL_TOPICS
} from "./similarity/file-similarity-signals";

type InheritedRuntime = {
	__epochInheritedMarkRecomputeReason?: string;
	__epochInheritedMarkRecomputeTimer?: number | null;
	ensureSimilarityStoreLoaded?: () => Promise<void>;
	ensureTermSimilarityStoreLoaded?: () => Promise<void>;
	similarityIndex?: { files?: Record<string, unknown> } | null;
	termSimilarityIndex?: { files?: Record<string, TopicStoreRecord> } | null;
	__epochInheritedMarkIndexByPath?: unknown;
	__epochInheritedMarkSourceByPath?: unknown;
	__epochInheritedMarkReasonByPath?: unknown;
	__epochInheritedMarkComputedAt?: number;
};

type TopicStoreRecord = {
	term?: string;
	score?: number;
	vocabularySig?: string;
};

type SimilarityIndexerLike = {
	index: Record<string, DateEntry[]>;
	getIndexedPaths: () => string[];
	getFileEmbeddingTerm: (path: string) => string;
	getFileMarkColor: (path: string) => number | null;
};

type DateEntryRuntime = DateEntry & {
	pinned?: boolean;
	originalDate?: string;
	blockStart?: number;
	blockEnd?: number;
	aiSummary?: string;
	summary?: string;
	file?: string;
	source?: string;
	markColor?: number;
};
 

export interface InheritedMarkMethods {
	scheduleInheritedMarkRecompute(reason?: string): void;
	recomputeInheritedMarksNow(reason?: string): Promise<void>;
	clearInheritedMarksCache(): void;
	
}

function isDateKey(s: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function isSyntheticPinnedTodayEntry(entry: DateEntry, dateKey: string): boolean {
	try {
		const runtime = entry as DateEntryRuntime;
		if (runtime.pinned !== true) return false;
		const original = typeof runtime.originalDate === "string" ? String(runtime.originalDate) : "";
		if (!original || !isDateKey(original)) return false;
		return original !== String(dateKey || "");
	} catch {
		return false;
	}
}

function parseEpochRange(epochPath: string): { start: string; end: string } | null {
	const key = String(epochPath || "").trim();
	if (!key.startsWith("epoch://")) return null;
	const m = key.match(/^epoch:\/\/[^/]+\/(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/);
	if (!m) return null;
	const start = m[1];
	const end = m[2];
	if (!isDateKey(start) || !isDateKey(end)) return null;
	return { start, end };
}

function extractLineCountFromEntry(entry: DateEntry): number {
	const runtime = entry as DateEntryRuntime;
	const bs = Number(runtime.blockStart ?? 0);
	const be = Number(runtime.blockEnd ?? 0);
	if (Number.isFinite(bs) && Number.isFinite(be) && be >= bs) {
		return Math.max(0, Math.floor(be) - Math.floor(bs) + 1);
	}
	const txt = String(runtime.aiSummary || runtime.summary || "").trim();
	if (!txt) return 0;
	return txt.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

function getAllEpochPathsFromIndex(index: Record<string, DateEntry[]>): string[] {
	const out = new Set<string>();
	for (const entries of Object.values(index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const e of entries) {
			const runtime = e as DateEntryRuntime;
			const fp = String(runtime.file || "");
			if (!fp) continue;
			if (fp.startsWith("epoch://")) out.add(fp);
			if (String(runtime.source || "") === "epoch" && fp.startsWith("epoch://")) out.add(fp);
		}
	}
	return Array.from(out);
}

function collectMarkedSeedPaths(plugin: EpochPlugin): string[] {
	try {
		const filesObj: unknown = plugin.indexer.toJSON().files;
		if (!filesObj || typeof filesObj !== "object") return [];

		const paths: string[] = [];
			for (const [p, data] of Object.entries(filesObj as Record<string, unknown>)) {
			if (typeof p !== "string" || !p) continue;
			const anyD = data as DateEntryRuntime;
			const rawIdx: unknown = typeof anyD.markColor === "number" ? anyD.markColor : null;
			if (typeof rawIdx !== "number" || !Number.isFinite(rawIdx)) continue;
			const idx = Math.floor(rawIdx);
			if (idx < 1) continue;
			paths.push(p);
		}
		return paths;
	} catch {
		return [];
	}
}

export function buildTopicCandidatesFromSeeds(params: {
	seedPaths: string[];
	indexer: SimilarityIndexerLike;
	termStoreFiles: Record<string, TopicStoreRecord>;
	zeroShotMinScore: number;
	vocabularySig: string;
	visibleSet: Set<string>;
}): Map<string, Array<{ path: string; score: number }>> {
	const { seedPaths, indexer, termStoreFiles, zeroShotMinScore, vocabularySig, visibleSet } = params;
	const explicitTopics = new Map<string, string>();
	try {
		const paths: string[] = indexer.getIndexedPaths();
		for (const p of paths) {
			const t0 = String(indexer.getFileEmbeddingTerm(p) || "").trim();
			const t = canonicalizeTopicTerm(t0);
			if (!t || isNoTopicSentinel(t)) continue;
			explicitTopics.set(p, t);
		}
	} catch {
		// ignore
	}

	const out = new Map<string, Array<{ path: string; score: number }>>();
	for (const seedPath of seedPaths) {
		if (typeof seedPath !== "string" || !seedPath) continue;
		if (seedPath.startsWith("epoch://")) continue;
		const explicitSeedTerm = explicitTopics.get(seedPath) || "";
		const rec = termStoreFiles?.[seedPath];
		const recTerm = canonicalizeTopicTerm(typeof rec?.term === "string" ? String(rec.term).trim() : "");
		const recScore = Number(rec?.score ?? 0);
		const recSig = String(rec?.vocabularySig ?? "");
		let seedTerm = explicitSeedTerm;
		if (!seedTerm && recTerm && Number.isFinite(recScore) && recScore >= zeroShotMinScore) {
			if (!vocabularySig || !recSig || recSig === vocabularySig) seedTerm = recTerm;
		}
		if (!seedTerm) continue;
		const dedup = new Map<string, number>();
		for (const [p, t] of explicitTopics) {
			if (!p || p === seedPath) continue;
			if (!visibleSet.has(p)) continue;
			if (t !== seedTerm) continue;
			dedup.set(p, 1);
		}
		for (const [p, recOther] of Object.entries(termStoreFiles ?? {})) {
			if (!p || p === seedPath) continue;
			if (!visibleSet.has(p)) continue;
			const termOther = canonicalizeTopicTerm(typeof (recOther)?.term === "string" ? String((recOther).term).trim() : "");
			if (!termOther || termOther !== seedTerm) continue;
			const explicitOther = explicitTopics.get(p) || "";
			if (explicitOther && explicitOther !== seedTerm) continue;
			const s = Number((recOther)?.score ?? 0);
			const sigOther = String((recOther)?.vocabularySig ?? "");
			if (Number.isFinite(s) && s >= zeroShotMinScore) {
				if (!vocabularySig || !sigOther || sigOther === vocabularySig) {
					const prev = dedup.get(p) ?? 0;
					dedup.set(p, Math.max(prev, Math.max(0, Math.min(1, s))));
				}
			}
		}
		if (dedup.size > 0) {
			out.set(seedPath, Array.from(dedup.entries()).map(([path, score]) => ({ path, score })));
		}
	}
	return out;
}

export const inheritedMarkMethods: InheritedMarkMethods = {
	scheduleInheritedMarkRecompute(this: EpochPlugin, reason?: string): void {
		try {
			const runtime = this as unknown as InheritedRuntime;
			runtime.__epochInheritedMarkRecomputeReason = String(reason || runtime.__epochInheritedMarkRecomputeReason || "");
			if (runtime.__epochInheritedMarkRecomputeTimer != null) return;
			runtime.__epochInheritedMarkRecomputeTimer = window.setTimeout(() => {
				runtime.__epochInheritedMarkRecomputeTimer = null;
				void this.recomputeInheritedMarksNow(runtime.__epochInheritedMarkRecomputeReason).catch(() => {
					// swallow
				});
			}, 250);
		} catch {
			// ignore
		}
	},

	async recomputeInheritedMarksNow(this: EpochPlugin, _reason?: string): Promise<void> {
		const runtime = this as unknown as InheritedRuntime;
		try {
			if (!this.hasProAccess?.()) {
				this.clearInheritedMarksCache();
				this.refreshEpochViews();
				return;
			}

			const seedPaths = collectMarkedSeedPaths(this);
			if (seedPaths.length === 0) {
				this.clearInheritedMarksCache();
				this.refreshEpochViews();
				return;
			}

			const vectorsEnabled = embeddingsSimilarityEnabled(this);
			const threshold = vectorsEnabled ? getEffectiveSimilarityThreshold(this) : 0;

			const topicsEnabled = isTopicSimilarityEnabled(this);
			const zeroShotMinScore = topicsEnabled ? getEffectiveZeroShotMinScore(this) : 0;

			if (vectorsEnabled) {
				try {
					await runtime.ensureSimilarityStoreLoaded?.();
				} catch {
					// ignore
				}
			}

			if (topicsEnabled) {
				try {
					await runtime.ensureTermSimilarityStoreLoaded?.();
				} catch {
					// ignore
				}
			}

			const indexerAny = this.indexer as unknown as SimilarityIndexerLike;
			const index: Record<string, DateEntry[]> = indexerAny.index ?? {};
			const visiblePaths: string[] = [];
			try {
				for (const p of this.indexer.getIndexedPaths()) {
					if (typeof p === "string" && p) visiblePaths.push(p);
				}
			} catch {
				// ignore
			}
			for (const ep of getAllEpochPathsFromIndex(index)) visiblePaths.push(ep);
			if (visiblePaths.length === 0) {
				this.clearInheritedMarksCache();
				this.refreshEpochViews();
				return;
			}

			const storeFiles = (runtime.similarityIndex?.files ?? {}) as Record<string, { v?: number[] }>;
			const visibleSet = new Set<string>(visiblePaths);
			const explicitTermByPath = new Map<string, string>();
			try {
				const paths: string[] = indexerAny.getIndexedPaths();
				for (const p of paths) {
					if (!p || typeof p !== "string" || p.startsWith("epoch://")) continue;
					const t0 = String(indexerAny.getFileEmbeddingTerm(p) || "").trim();
					const t = canonicalizeTopicTerm(t0);
					if (t && !isNoTopicSentinel(t)) explicitTermByPath.set(p, t);
				}
			} catch {
				// ignore
			}

			const normalSeeds: string[] = seedPaths.filter((p) => typeof p === "string" && !!p && !p.startsWith("epoch://"));
			const useLinks = getEffectiveSimilarityUseLinks(this);
			const useTags = getEffectiveSimilarityUseTags(this);
			const vocab = getTermVocabulary(this);
			const currentVocabSig = String(vocab.sig || "");

			const maskByPath = new Map<string, number>();
			const mask = (p: string): number => {
				const prev = maskByPath.get(p);
				if (typeof prev === "number") return prev;
				const m = getFileSimilaritySignalMask(this, p);
				maskByPath.set(p, m);
				return m;
			};
			const can = (seedPath: string, candPath: string, requiredSignal: number): boolean => {
				const seedMask = mask(seedPath);
				if (seedMask === 0) return false;
				return canMatchBySignalMask(seedMask, mask(candPath), requiredSignal);
			};

			// Precomputed candidates used by computeInheritedMarkData.
			// Keep topic candidates separate from graph candidates so priority can be applied deterministically.
			const termCandidatesBySeedPath = new Map<string, Array<{ path: string; score: number }>>();
			const linkCandidatesBySeedPath = new Map<string, Array<{ path: string }>>();
			const tagCandidatesBySeedPath = new Map<string, Array<{ path: string }>>();

			if (normalSeeds.length > 0) {
				for (const seedPath of normalSeeds) {
					if (typeof seedPath !== "string" || !seedPath) continue;
					if (seedPath.startsWith("epoch://")) continue;

					if (useLinks && can(seedPath, seedPath, SIGNAL_LINKS)) {
						try {
							const forced = new Set<string>();
							for (const p of getDirectLinkedPaths(this, seedPath)) {
								if (!p || typeof p !== "string") continue;
								if (p === seedPath) continue;
								if (p.startsWith("epoch://")) continue;
								if (!visibleSet.has(p)) continue;
								if (!can(seedPath, p, SIGNAL_LINKS)) continue;
								forced.add(p);
							}
							if (forced.size > 0) {
								linkCandidatesBySeedPath.set(
									seedPath,
									Array.from(forced).sort().map((path) => ({ path }))
								);
							}
						} catch {
							// ignore
						}
					}

					if (useTags && can(seedPath, seedPath, SIGNAL_TAGS)) {
						try {
							const forced = new Set<string>();
							for (const p of getSameTagPaths(this, seedPath)) {
								if (!p || typeof p !== "string") continue;
								if (p === seedPath) continue;
								if (p.startsWith("epoch://")) continue;
								if (!visibleSet.has(p)) continue;
								if (!can(seedPath, p, SIGNAL_TAGS)) continue;
								forced.add(p);
							}
							if (forced.size > 0) {
								tagCandidatesBySeedPath.set(
									seedPath,
									Array.from(forced).sort().map((path) => ({ path }))
								);
							}
						} catch {
							// ignore
						}
					}
				}
			}
			if (topicsEnabled && seedPaths.length > 0) {
				try {
					const termStoreFiles: Record<string, TopicStoreRecord> = runtime.termSimilarityIndex?.files ?? {};
					const topicCandidates = buildTopicCandidatesFromSeeds({
						seedPaths,
						indexer: this.indexer,
						termStoreFiles,
						zeroShotMinScore,
						vocabularySig: currentVocabSig,
						visibleSet
					});
					for (const [seedPath, candidates] of topicCandidates) {
						if (candidates.length > 0) termCandidatesBySeedPath.set(seedPath, candidates);
					}
				} catch {
					// ignore
				}
			}

			// Precompute epoch child records map for this recompute pass.
			const epochChildByEpoch = new Map<string, EpochChildRecord[]>();
			for (const ep of getAllEpochPathsFromIndex(index)) {
				const range = parseEpochRange(ep);
				if (!range) continue;
				const perFileBestLines = new Map<string, number>();
				for (const [dateKey, list] of Object.entries(index)) {
					if (!isDateKey(dateKey)) continue;
					if (dateKey < range.start || dateKey > range.end) continue;
					if (!Array.isArray(list) || list.length === 0) continue;
					for (const e of list) {
						if (!e) continue;
						const runtimeEntry = e as DateEntryRuntime;
						// Synthetic pinned-today entries are clones of the real anchor entry with
						// `date` rewritten to today and `originalDate` set to the real date key.
						// Exclude them from epoch child-record votes so they don't skew epoch marks.
							if (isSyntheticPinnedTodayEntry(e, dateKey)) continue;
						const fp = String(runtimeEntry.file || "");
						if (!fp || fp.startsWith("epoch://")) continue;
						if (String(runtimeEntry.source || "") === "epoch") continue;
						const lines = extractLineCountFromEntry(e);
						const prev = perFileBestLines.get(fp) ?? 0;
						if (lines > prev) perFileBestLines.set(fp, lines);
					}
				}
				const out: EpochChildRecord[] = Array.from(perFileBestLines.entries()).map(([path, lineCount]) => ({
					path,
					lineCount
				}));
				epochChildByEpoch.set(ep, out);
			}

			const inherited: InheritedMarkData | null = computeInheritedMarkData({
				visiblePaths,
				seedPaths: normalSeeds,
				storeFiles,
				linkCandidatesBySeedPath: linkCandidatesBySeedPath.size > 0 ? linkCandidatesBySeedPath : undefined,
				tagCandidatesBySeedPath: tagCandidatesBySeedPath.size > 0 ? tagCandidatesBySeedPath : undefined,
				termCandidatesBySeedPath: termCandidatesBySeedPath.size > 0 ? termCandidatesBySeedPath : undefined,
				canMatch: (seedPath, candPath, reason) => {
					if (!seedPath || !candPath) return false;
					if (seedPath.startsWith("epoch://") || candPath.startsWith("epoch://")) return false;
					if (reason === "link") return can(seedPath, candPath, SIGNAL_LINKS);
					if (reason === "tag") return can(seedPath, candPath, SIGNAL_TAGS);
					if (reason === "title") return can(seedPath, candPath, SIGNAL_TITLE);
					if (reason === "topic") return can(seedPath, candPath, SIGNAL_TOPICS);
					if (reason === "embedding") return can(seedPath, candPath, SIGNAL_SEMANTICS);
					return true;
				},
				getFileMarkColor: (p) => this.indexer.getFileMarkColor(p),
				getEpochChildRecords: (epochPath) => epochChildByEpoch.get(epochPath) ?? [],
				threshold,
				termMinScore: topicsEnabled ? zeroShotMinScore : 0,
				titleJwThreshold: getEffectiveTitleSimilarityThreshold(this)
			});

			runtime.__epochInheritedMarkIndexByPath = inherited?.indexByPath ?? null;
			runtime.__epochInheritedMarkSourceByPath = inherited?.sourceByPath ?? null;
			runtime.__epochInheritedMarkReasonByPath = inherited?.reasonByPath && inherited.reasonByPath.size > 0
				? inherited.reasonByPath
				: null;
			runtime.__epochInheritedMarkComputedAt = Date.now();
			this.refreshEpochViews();
		} catch {
			// If anything fails, don't break indexing.
			this.clearInheritedMarksCache();
			this.refreshEpochViews();
		}
	},

	clearInheritedMarksCache(this: EpochPlugin): void {
		try {
			const runtime = this as unknown as InheritedRuntime;
			runtime.__epochInheritedMarkIndexByPath = null;
			runtime.__epochInheritedMarkSourceByPath = null;
			runtime.__epochInheritedMarkReasonByPath = null;
			runtime.__epochInheritedMarkComputedAt = 0;
		} catch {
			// ignore
		}
	}
};
