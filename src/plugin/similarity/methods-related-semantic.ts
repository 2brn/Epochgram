import { TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import {
	embeddingsSimilarityEnabled,
	getSimilarityModelId,
	isTopicSimilarityEnabled,
	TITLE_SIMILARITY_MAX_LEN_DIFF,
} from "./config";
import { getSimilarityWorker } from "./worker-factory";
import { readStore } from "./store";
import { dot } from "./math";
import { getDirectLinkedPaths, getSameTagPaths } from "./graph";
import { getNoteTitleFromPath, jaroWinkler, normalizeTitleForSimilarity } from "../../utils";
import { canonicalizeTopicTerm, parseTopicTerm } from "../../utils";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { readTermStore } from "../similarity-term-store";
import {
	getEffectiveSimilarityUseLinks,
	getEffectiveSimilarityUseTags,
	getEffectiveTitleSimilarityThreshold,
	getEffectiveZeroShotMinScore,
	hasSimilarityAccess
} from "../pro-feature-state";
import {
	canMatchBySignalMask,
	getFileSimilaritySignalMask,
	SIGNAL_LINKS,
	SIGNAL_SEMANTICS,
	SIGNAL_TAGS,
	SIGNAL_TITLE,
	SIGNAL_TOPICS
} from "./file-similarity-signals";

export const methodsRelatedSemantic: Pick<
	SimilarityMethods,
	"getSemanticRelatedPathsForFile" | "getSemanticRelatedScoredForFile"
> = {
	async getSemanticRelatedPathsForFile(this: EpochPlugin, filePath: string): Promise<Set<string>> {
		const out = new Set<string>();
		const scored = await (this as any).getSemanticRelatedScoredForFile(filePath);
		for (const s of scored) out.add(s.path);
		return out;
	},

	async getSemanticRelatedScoredForFile(
		this: EpochPlugin,
		filePath: string
	): Promise<Array<{ path: string; score: number }>> {
		if (!hasSimilarityAccess(this)) return [];
		const threshold = Number(this.settings.similarityThreshold);
		const zeroShotMin = getEffectiveZeroShotMinScore(this);
		if (!filePath) return [];
		const maskByPath = new Map<string, number>();
		const mask = (p: string): number => {
			const prev = maskByPath.get(p);
			if (typeof prev === "number") return prev;
			const m = getFileSimilaritySignalMask(this as any, p);
			maskByPath.set(p, m);
			return m;
		};
		const centerMask = mask(filePath);
		if (centerMask === 0) return [];
		const allows = (otherPath: string, signalMask: number): boolean => canMatchBySignalMask(centerMask, mask(otherPath), signalMask);

		const vectorsEnabled = embeddingsSimilarityEnabled(this);
		let embeddingTerm = allows(filePath, SIGNAL_TOPICS) ? canonicalizeTopicTerm(getEmbeddingTermForPath(this, filePath)) : "";

		if (!embeddingTerm && isTopicSimilarityEnabled(this) && (centerMask & SIGNAL_TOPICS) !== 0) {
			try {
				const store0 = await readTermStore(this);
				const rec0: any = store0?.files ? (store0.files as any)[filePath] : null;
				const inferred = typeof rec0?.term === "string" ? String(rec0.term).trim() : "";
				const s0 = Number(rec0?.score ?? 0);
				const okScore = inferred && Number.isFinite(s0) && s0 >= zeroShotMin;
				embeddingTerm = okScore ? canonicalizeTopicTerm(inferred) : "";
			} catch {
				embeddingTerm = "";
			}
		}
		const parsed = parseTopicTerm(embeddingTerm);
		const wantsZeroShot = isTopicSimilarityEnabled(this) && (centerMask & SIGNAL_TOPICS) !== 0 && parsed.kind === "auto";

		const forcedLinks = new Set<string>();
		const forcedTags = new Set<string>();
		try {
			const useLinks = getEffectiveSimilarityUseLinks(this);
			const useTags = getEffectiveSimilarityUseTags(this);
			if (useLinks && (centerMask & SIGNAL_LINKS) !== 0) {
				for (const p of getDirectLinkedPaths(this, filePath)) {
					if (!p) continue;
					if (!allows(p, SIGNAL_LINKS)) continue;
					forcedLinks.add(p);
				}
			}
			if (useTags && (centerMask & SIGNAL_TAGS) !== 0) {
				for (const p of getSameTagPaths(this, filePath)) {
					if (!p) continue;
					if (!allows(p, SIGNAL_TAGS)) continue;
					forcedTags.add(p);
				}
			}
		} catch {
			// ignore
		}

		const forcedScored: Array<{ path: string; score: number }> = [];
		for (const p of new Set<string>([...forcedLinks, ...forcedTags])) {
			const af = this.app.vault.getAbstractFileByPath(p);
			if (!(af instanceof TFile)) continue;
			if (!this.shouldIndexFile(af)) continue;
			forcedScored.push({ path: p, score: 1 });
		}

		const titleScored: Array<{ path: string; score: number }> = [];
		try {
			const titleThr = getEffectiveTitleSimilarityThreshold(this);
			const titleMaxLenDiff = TITLE_SIMILARITY_MAX_LEN_DIFF;

			const centerTitle = titleThr > 0 && (centerMask & SIGNAL_TITLE) !== 0 ? normalizeTitleForSimilarity(getNoteTitleFromPath(filePath)) : "";
			if (centerTitle) {
				const files = this.app.vault.getFiles();
				for (const f of files) {
					if (!f || f.path === filePath) continue;
					if (!this.shouldIndexFile(f)) continue;
					if (forcedLinks.has(f.path) || forcedTags.has(f.path)) continue;
					if (!allows(f.path, SIGNAL_TITLE)) continue;
					const otherTitle = normalizeTitleForSimilarity(getNoteTitleFromPath(f.path));
					if (!otherTitle) continue;
					if (titleMaxLenDiff >= 0) {
						const diff = Math.abs(centerTitle.length - otherTitle.length);
						if (diff > titleMaxLenDiff) continue;
					}
					const score = jaroWinkler(centerTitle, otherTitle);
					if (score >= titleThr) {
						titleScored.push({ path: f.path, score });
					}
				}
			}
		} catch {
			// ignore
		}

		const termScored: Array<{ path: string; score: number }> = [];
		if (wantsZeroShot) {
			try {
				const idxAny: any = this.indexer as any;
				const workerAvailable = !!getSimilarityWorker(this);
				const vocab = getTermVocabulary(this);

				if (workerAvailable) {
					try {
						const store0 = await readTermStore(this);
						const rec0 = (store0.files as any)?.[filePath];
						if (!rec0 || rec0.vocabularySig !== vocab.sig) {
							(this as any).queueTermSimilarityUpdate?.(filePath);
						}
					} catch {
						// ignore
					}
				}

				try {
					const indexed: unknown = idxAny.getIndexedPaths();
					const paths: string[] = Array.isArray(indexed) ? indexed : [];
					for (const p of paths) {
						if (!p || typeof p !== "string") continue;
						if (p === filePath) continue;
						if (forcedLinks.has(p) || forcedTags.has(p)) continue;
						if (!allows(p, SIGNAL_TOPICS)) continue;
						const t = String(idxAny.getFileEmbeddingTerm(p) || "").trim();
						const tc = canonicalizeTopicTerm(t);
						if (!tc || tc !== embeddingTerm) continue;
						const af = this.app.vault.getAbstractFileByPath(p);
						if (!(af instanceof TFile)) continue;
						if ((af.extension || "").toLowerCase() !== "md") continue;
						if (!this.shouldIndexFile(af)) continue;
						termScored.push({ path: p, score: 1 });
					}
				} catch {
					// ignore
				}

				const store = await readTermStore(this);
				let enqueuedStale = 0;
				const ENQUEUE_STALE_LIMIT = 25;
				for (const [p, rec] of Object.entries(store.files)) {
					if (!rec) continue;
					if (!p || p === filePath) continue;
					if (forcedLinks.has(p) || forcedTags.has(p)) continue;
					if (!allows(p, SIGNAL_TOPICS)) continue;
					if (workerAvailable && typeof (rec as any)?.vocabularySig === "string" && (rec as any).vocabularySig !== vocab.sig) {
						if (enqueuedStale < ENQUEUE_STALE_LIMIT) {
							(this as any).queueTermSimilarityUpdate?.(p);
							enqueuedStale++;
						}
					}
					const recTerm = typeof (rec as any)?.term === "string" ? String((rec as any).term).trim() : "";
					if (!recTerm || recTerm !== embeddingTerm) continue;
					const s = Number((rec as any)?.score ?? 0);
					if (!(s >= zeroShotMin)) continue;
					try {
						const explicitOther = String(idxAny.getFileEmbeddingTerm(p) || "").trim();
						const explicitCanon = canonicalizeTopicTerm(explicitOther);
						if (explicitCanon && explicitCanon !== embeddingTerm) continue;
					} catch {
						// ignore
					}
					const af = this.app.vault.getAbstractFileByPath(p);
					if (!(af instanceof TFile)) continue;
					if ((af.extension || "").toLowerCase() !== "md") continue;
					if (!this.shouldIndexFile(af)) continue;
					termScored.push({ path: p, score: Math.max(0, Math.min(1, s)) });
				}
			} catch {
				// ignore
			}
		}

		const mergeSignals = (items: Array<{ path: string; score: number }>) => {
			const best = new Map<string, number>();
			const add = (p: string, score: number) => {
				if (!p) return;
				const prev = best.get(p);
				if (prev == null || score > prev) best.set(p, score);
			};
			for (const it of forcedScored) add(it.path, it.score);
			for (const it of titleScored) add(it.path, it.score);
			for (const it of termScored) add(it.path, it.score);
			for (const it of items) add(it.path, it.score);
			const all = Array.from(best.entries()).map(([path, score]) => ({ path, score }));
			all.sort((a, b) => b.score - a.score);
			return all;
		};

		if (!vectorsEnabled) {
			return mergeSignals([]);
		}

		const store = await readStore(this);
		const modelId = getSimilarityModelId(this);
		if ((store as any).model !== modelId) {
			return mergeSignals([]);
		}

		const center: any = (store as any).files?.[filePath];
		if (!center) {
			(this as any).queueVectorUpdate?.(filePath);
			return mergeSignals([]);
		}

		const scored: Array<{ path: string; score: number }> = [];
		for (const [path, rec] of Object.entries((store as any).files ?? {})) {
			if (!rec || !Array.isArray((rec as any).v) || (rec as any).v.length === 0) continue;
			if (path === filePath) continue;
			if (forcedLinks.has(path) || forcedTags.has(path)) continue;
			if ((centerMask & SIGNAL_SEMANTICS) === 0) continue;
			if (!allows(path, SIGNAL_SEMANTICS)) continue;
			const score = dot((center as any).v, (rec as any).v);
			if (threshold > 0) {
				if (score >= threshold) scored.push({ path, score });
			} else {
				scored.push({ path, score });
			}
		}

		return mergeSignals(scored);
	},
};
