import { canonicalizeTopicTerm, isNoTopicSentinel, NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "utils";

import type { EpochCanvas } from "../epoch-canvas";
import type { EpochPlugin } from "../../main";
import { getEffectiveZeroShotMinScore, hasSimilarityAccess } from "../../plugin/pro-feature-state";
import { embeddingsSimilarityEnabled, isTopicSimilarityEnabled } from "../../plugin/similarity/config";

type SemanticScoredPath = { path: string; score: number };

type SemanticIndexData = {
	contentHash?: string;
	indexedMtimeMs?: number;
	indexedSize?: number;
};

type SemanticFileData = {
	embeddingTerm?: string;
};

type SemanticTermFileData = {
	term?: string;
	score?: number;
};

type SemanticIndexerLike = {
	files?: Record<string, SemanticFileData>;
	getFileEmbeddingTerm?: (path: string) => string | null | undefined;
	getIndexedPaths?: () => string[];
	getFileIndexData?: (path: string) => SemanticIndexData | null | undefined;
};

type SemanticPluginLike = {
	notifyProFeature?: (feature: string) => void;
	settings?: {
		similarityThreshold?: number;
		similarityUseLinks?: boolean;
		similarityUseTags?: boolean;
		similarityTitleJwThreshold?: number;
		similarityZeroShotMinScore?: number;
	};
	indexer?: SemanticIndexerLike;
	termSimilarityStoreRev?: number;
	similarityStoreRev?: number;
	termSimilarityLoaded?: boolean;
	termSimilarityIndex?: { files?: Record<string, SemanticTermFileData> };
	ensureSimilarityStoreLoaded?: () => Promise<void> | void;
	ensureTermSimilarityStoreLoaded?: () => Promise<void> | void;
	getSemanticRelatedScoredForFile?: (path: string) => Promise<SemanticScoredPath[] | null | undefined>;
	getSemanticRelatedPathsForFile?: (path: string) => Promise<Set<string> | null | undefined>;
	__epochInheritedMarkSourceByPath?: Map<string, string>;
};

type SemanticCanvasState = {
	plugin?: SemanticPluginLike;
	activeFilePath?: string | null;
	searchQuery?: string;
	cachedPathsWithEmbeddingTerm?: Set<string> | null;
	cachedPathsWithClassifiedTerm?: Set<string> | null;
	cachedClassifiedTermLastUpdatedAt?: number | null;
	semanticRelatedActiveTerm?: string | null;
	semanticRelatedTermPaths?: Set<string> | null;
	semanticRelatedTermLastUpdatedAt?: number | null;
	semanticRelatedTermLoadInFlight?: boolean;
	semanticRelatedBasePath?: string | null;
	semanticRelatedRequestId: number;
	semanticRelatedLastThreshold?: number | null;
	semanticRelatedLastZeroShotMinScore?: number | null;
	semanticRelatedLastUseLinks?: boolean | null;
	semanticRelatedLastUseTags?: boolean | null;
	semanticRelatedLastTitleJwThreshold?: number | null;
	semanticRelatedLastSimilarityStoreRev?: number | null;
	semanticRelatedLastTermSimilarityStoreRev?: number | null;
	semanticRelatedLastBasePath?: string | null;
	semanticRelatedLastBaseIndexedKey?: string | null;
	semanticRelatedPaths?: Set<string> | null;
	semanticRelatedScored?: SemanticScoredPath[] | null;
	draw(): void;
	isEpochsViewActive(): boolean;
};

function state(canvas: EpochCanvas): SemanticCanvasState {
	return canvas as unknown as SemanticCanvasState;
}

function asEpochPlugin(plugin: SemanticPluginLike | undefined): EpochPlugin | null {
	return plugin ? (plugin as unknown as EpochPlugin) : null;
}

export function hasProAccess(canvas: EpochCanvas): boolean {
	const c = state(canvas);
	const plugin = asEpochPlugin(c.plugin);
	return !!plugin && hasSimilarityAccess(plugin);
}

export function requirePro(canvas: EpochCanvas, feature: string): boolean {
	const c = state(canvas);
	if (hasProAccess(canvas)) return true;
	c?.plugin?.notifyProFeature?.(feature);
	return false;
}

export function updatePathsWithEmbeddingTerm(canvas: EpochCanvas): void {
	const c = state(canvas);
	try {
		const plugin = asEpochPlugin(c.plugin);
		if (!hasProAccess(canvas) || !plugin || !isTopicSimilarityEnabled(plugin)) {
			c.cachedPathsWithEmbeddingTerm = null;
			return;
		}
		const idx = c?.plugin?.indexer;
		if (!idx) {
			c.cachedPathsWithEmbeddingTerm = null;
			return;
		}
		const files = idx.files;
		if (!files || typeof files !== "object") {
			c.cachedPathsWithEmbeddingTerm = null;
			return;
		}
		const out = new Set<string>();
		for (const [path, data] of Object.entries(files)) {
			const term = typeof data?.embeddingTerm === "string" ? String(data.embeddingTerm).trim() : "";
			if (term && !isNoTopicSentinel(term)) out.add(path);
		}
		c.cachedPathsWithEmbeddingTerm = out.size > 0 ? out : null;
	} catch {
		c.cachedPathsWithEmbeddingTerm = null;
	}
}

export function updatePathsWithClassifiedTerm(canvas: EpochCanvas, force = false): boolean {
	const c = state(canvas);
	try {
		const plugin = asEpochPlugin(c.plugin);
		if (!hasProAccess(canvas) || !plugin || !isTopicSimilarityEnabled(plugin)) {
			const changed = c.cachedPathsWithClassifiedTerm != null;
			c.cachedPathsWithClassifiedTerm = null;
			c.cachedClassifiedTermLastUpdatedAt = null;
			return changed;
		}
		const zeroShotMin = getEffectiveZeroShotMinScore(plugin);
		const pluginAny = c?.plugin;
		const storeRev = Number(pluginAny?.termSimilarityStoreRev ?? 0) || 0;
		if (!force && c.cachedClassifiedTermLastUpdatedAt === storeRev) {
			return false;
		}
		const termStoreLoaded =
			pluginAny?.termSimilarityLoaded === true &&
			!!pluginAny?.termSimilarityIndex &&
			typeof pluginAny.termSimilarityIndex === "object";
		if (!termStoreLoaded) {
			const changed = c.cachedPathsWithClassifiedTerm != null;
			c.cachedPathsWithClassifiedTerm = null;
			c.cachedClassifiedTermLastUpdatedAt = null;
			return changed;
		}

		const termFiles: Record<string, SemanticTermFileData> = pluginAny?.termSimilarityIndex?.files ?? {};
		const out = new Set<string>();
		const idxAny = c?.plugin?.indexer;
		for (const [p, rec] of Object.entries(termFiles)) {
			if (!p || typeof p !== "string") continue;
			if (p.startsWith("epoch://")) continue;
			const term = typeof rec?.term === "string" ? String(rec.term).trim() : "";
			if (!term) continue;
			const s = Number(rec?.score ?? 0);
			if (!Number.isFinite(s)) continue;
			if (zeroShotMin > 0 && s < zeroShotMin) continue;
			try {
				const explicit = String(idxAny?.getFileEmbeddingTerm?.(p) || "").trim();
				if (explicit) continue;
			} catch {
				// ignore
			}
			out.add(p);
		}

		const next = out.size > 0 ? out : null;
		const changed =
			(c.cachedPathsWithClassifiedTerm == null) !== (next == null) ||
			(c.cachedPathsWithClassifiedTerm != null && next != null && c.cachedPathsWithClassifiedTerm.size !== next.size);
		c.cachedPathsWithClassifiedTerm = next;
		c.cachedClassifiedTermLastUpdatedAt = storeRev || null;
		return changed;
	} catch {
		const changed = c.cachedPathsWithClassifiedTerm != null;
		c.cachedPathsWithClassifiedTerm = null;
		c.cachedClassifiedTermLastUpdatedAt = null;
		return changed;
	}
}

export function updateSemanticRelatedTermPaths(canvas: EpochCanvas): void {
	const c = state(canvas);
	try {
		const prevActive: string = typeof c.semanticRelatedActiveTerm === "string" ? c.semanticRelatedActiveTerm : "";
		const prevPaths: Set<string> | null = c.semanticRelatedTermPaths instanceof Set ? c.semanticRelatedTermPaths : null;
		const prevUpdatedAt: number | null = typeof c.semanticRelatedTermLastUpdatedAt === "number" ? c.semanticRelatedTermLastUpdatedAt : null;
		const maybeDrawIfChanged = (nextActive: string | null, nextPaths: Set<string> | null, nextUpdatedAt: number | null) => {
			const na = typeof nextActive === "string" ? nextActive : "";
			const np = nextPaths instanceof Set ? nextPaths : null;
			const changedActive = na !== prevActive;
			const changedUpdatedAt = (nextUpdatedAt ?? null) !== (prevUpdatedAt ?? null);
			const changedPaths = (() => {
				if (prevPaths == null && np == null) return false;
				if ((prevPaths == null) !== (np == null)) return true;
				if (!prevPaths || !np) return true;
				if (prevPaths.size !== np.size) return true;
				for (const p of prevPaths) {
					if (!np.has(p)) return true;
				}
				return false;
			})();
			if (changedActive || changedPaths || changedUpdatedAt) {
				try {
					c.draw();
				} catch {
					// ignore
				}
			}
		};

		const path = c.activeFilePath;
		if (!path) {
			c.semanticRelatedTermLoadInFlight = false;
			c.semanticRelatedActiveTerm = null;
			c.semanticRelatedTermPaths = null;
			c.semanticRelatedTermLastUpdatedAt = null;
			maybeDrawIfChanged(null, null, null);
			return;
		}
		const plugin = asEpochPlugin(c.plugin);
		if (!hasProAccess(canvas) || !plugin || !isTopicSimilarityEnabled(plugin)) {
			c.semanticRelatedActiveTerm = null;
			c.semanticRelatedTermPaths = null;
			c.semanticRelatedTermLastUpdatedAt = null;
			maybeDrawIfChanged(null, null, null);
			return;
		}
		const zeroShotMin = getEffectiveZeroShotMinScore(plugin);

		let explicitTerm = "";
		try {
			explicitTerm = String(c?.plugin?.indexer?.getFileEmbeddingTerm?.(path) ?? "").trim();
		} catch {
			explicitTerm = "";
		}
		const explicitCanon = canonicalizeTopicTerm(explicitTerm);
		if (explicitCanon && isNoTopicSentinel(explicitCanon)) {
			c.semanticRelatedActiveTerm = null;
			c.semanticRelatedTermPaths = null;
			c.semanticRelatedTermLastUpdatedAt = null;
			maybeDrawIfChanged(null, null, null);
			return;
		}

		const anyPlugin = c?.plugin;
		const termStoreLoaded =
			anyPlugin?.termSimilarityLoaded === true &&
			!!anyPlugin?.termSimilarityIndex &&
			typeof anyPlugin.termSimilarityIndex === "object";
		if (!termStoreLoaded) {
			try {
				const ensureFn = c?.plugin?.ensureTermSimilarityStoreLoaded;
				if (!c.semanticRelatedTermLoadInFlight && typeof ensureFn === "function") {
					c.semanticRelatedTermLoadInFlight = true;
					void Promise.resolve(ensureFn.call(c.plugin))
						.catch(() => {
							// ignore
						})
						.finally(() => {
							c.semanticRelatedTermLoadInFlight = false;
							if (c.activeFilePath !== path) return;
							c.semanticRelatedTermLastUpdatedAt = null;
							c.draw();
						});
				}
			} catch {
				// ignore
			}
			return;
		}

		const storeRev = Number(anyPlugin?.termSimilarityStoreRev ?? 0) || 0;
		const termFiles: Record<string, SemanticTermFileData> = anyPlugin?.termSimilarityIndex?.files ?? {};
		let activeTerm = explicitCanon;
		if (!activeTerm) {
			const rec = termFiles[path];
			const inferred = typeof rec?.term === "string" ? String(rec.term).trim() : "";
			const s = Number(rec?.score ?? 0);
			const okScore = Number.isFinite(s) && (zeroShotMin <= 0 || s >= zeroShotMin);
			activeTerm = inferred && okScore ? canonicalizeTopicTerm(inferred) : "";
		}
		if (
			c.semanticRelatedTermPaths &&
			c.semanticRelatedTermLastUpdatedAt === storeRev &&
			String(c.semanticRelatedActiveTerm || "") === String(activeTerm || "")
		) {
			return;
		}
		c.semanticRelatedActiveTerm = activeTerm || null;
		if (!activeTerm) {
			c.semanticRelatedTermLoadInFlight = false;
			c.semanticRelatedTermPaths = null;
			c.semanticRelatedTermLastUpdatedAt = storeRev || null;
			maybeDrawIfChanged(null, null, storeRev || null);
			return;
		}

		const out = new Set<string>();
		out.add(path);
		try {
			const idxAny = c?.plugin?.indexer;
			const indexed: unknown = idxAny?.getIndexedPaths?.();
			const paths: string[] = Array.isArray(indexed)
				? indexed.filter((value): value is string => typeof value === "string")
				: [];
			for (const p of paths) {
				if (!p) continue;
				if (p.startsWith("epoch://")) continue;
				const t = canonicalizeTopicTerm(String(idxAny?.getFileEmbeddingTerm?.(p) || "").trim());
				if (t && t === activeTerm) out.add(p);
			}
		} catch {
			// ignore
		}
		for (const [p, rec] of Object.entries(termFiles)) {
			if (!p || typeof p !== "string") continue;
			if (p.startsWith("epoch://")) continue;
			if (!rec) continue;
			const recTerm = typeof rec?.term === "string" ? canonicalizeTopicTerm(String(rec.term).trim()) : "";
			if (!recTerm || recTerm !== activeTerm) continue;
			const s = Number(rec?.score ?? 0);
			if (!Number.isFinite(s)) continue;
			if (zeroShotMin > 0 && s < zeroShotMin) continue;
			try {
				const idxAny = c?.plugin?.indexer;
				const explicit = canonicalizeTopicTerm(String(idxAny?.getFileEmbeddingTerm?.(p) || "").trim());
				if (explicit && explicit !== activeTerm) continue;
			} catch {
				// ignore
			}
			out.add(p);
		}

		c.semanticRelatedTermPaths = out.size > 0 ? out : null;
		c.semanticRelatedTermLastUpdatedAt = storeRev || null;
		maybeDrawIfChanged(activeTerm, c.semanticRelatedTermPaths, storeRev || null);
	} catch {
		// ignore
	}
}

export function refreshSemanticRelatedForActiveFile(canvas: EpochCanvas, force: boolean = false): void {
	const c = state(canvas);
	const activePath = c.activeFilePath;
	const anyPlugin = c?.plugin;
	const similarityStoreRev = Number(anyPlugin?.similarityStoreRev ?? 0) || 0;
	const termSimilarityStoreRev = Number(anyPlugin?.termSimilarityStoreRev ?? 0) || 0;
	const basePath = (() => {
		const p = typeof activePath === "string" ? String(activePath) : "";
		if (!p || p.startsWith("epoch://")) return null;
		try {
			const pluginAny = c?.plugin;
			const srcMap: unknown = pluginAny?.__epochInheritedMarkSourceByPath;
			if (srcMap instanceof Map) {
				const src = String(srcMap.get(p) ?? "");
				if (src && !src.startsWith("epoch://")) return src;
			}
		} catch {
			// ignore
		}
		return p;
	})();
	c.semanticRelatedBasePath = basePath;
	const path = basePath;
	const baseIndexedKey = (() => {
		try {
			if (!path || typeof path !== "string") return null;
			const idxAny = c?.plugin?.indexer;
			if (!idxAny || typeof idxAny.getFileIndexData !== "function") return null;
			const data = idxAny.getFileIndexData(path) ?? null;
			const hash = typeof data?.contentHash === "string" ? String(data.contentHash).trim() : "";
			if (hash) return `h:${hash}`;
			const mtime = Number(data?.indexedMtimeMs ?? 0);
			const size = Number(data?.indexedSize ?? 0);
			if (Number.isFinite(mtime) && Number.isFinite(size) && mtime > 0 && size >= 0) {
				return `s:${mtime}:${size}`;
			}
			return null;
		} catch {
			return null;
		}
	})();
	const threshold = Number(c?.plugin?.settings?.similarityThreshold ?? 0);
	const rawUseLinks = c?.plugin?.settings?.similarityUseLinks;
	const rawUseTags = c?.plugin?.settings?.similarityUseTags;
	const useLinks = rawUseLinks !== false;
	const useTags = rawUseTags !== false;
	const rawTitleThr = Number(c?.plugin?.settings?.similarityTitleJwThreshold);
	const titleThr = Number.isFinite(rawTitleThr)
		? Math.max(0, Math.min(1, rawTitleThr))
		: NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
	const zeroShotMinRaw = Number(c?.plugin?.settings?.similarityZeroShotMinScore ?? 0);
	const zeroShotMin = Number.isFinite(zeroShotMinRaw) ? Math.max(0, Math.min(1, zeroShotMinRaw)) : 0;
	const plugin = asEpochPlugin(c.plugin);
	const embeddingsEnabled = !!plugin && embeddingsSimilarityEnabled(plugin);
	const topicsEnabled = !!plugin && isTopicSimilarityEnabled(plugin);
	const anySignalEnabled = embeddingsEnabled || topicsEnabled || titleThr > 0 || useLinks || useTags;
	try {
		if (
			hasProAccess(canvas) &&
			embeddingsEnabled &&
			typeof c.plugin?.ensureSimilarityStoreLoaded === "function"
		) {
			void Promise.resolve(c.plugin.ensureSimilarityStoreLoaded());
		}
	} catch {
		// ignore
	}
	try {
		if (
			hasProAccess(canvas) &&
			topicsEnabled &&
			typeof c.plugin?.ensureTermSimilarityStoreLoaded === "function"
		) {
			void Promise.resolve(c.plugin.ensureTermSimilarityStoreLoaded())
				.then(() => {
					updatePathsWithClassifiedTerm(canvas, true);
					c.semanticRelatedTermLastUpdatedAt = null;
					updateSemanticRelatedTermPaths(canvas);
					c.draw();
				})
				.catch(() => {
					// ignore
				});
		}
	} catch {
		// ignore
	}
	try {
		updatePathsWithClassifiedTerm(canvas);
	} catch {
		// ignore
	}
	try {
		updateSemanticRelatedTermPaths(canvas);
	} catch {
		// ignore
	}
	const hasScored = typeof c.plugin?.getSemanticRelatedScoredForFile === "function";
	const hasSet = typeof c.plugin?.getSemanticRelatedPathsForFile === "function";
	const similarQueryActive = /[!$]similar\b/i.test(String(c.searchQuery || ""));
	const canCompute =
		!!path &&
		(!c.isEpochsViewActive() || similarQueryActive) &&
		hasProAccess(canvas) &&
		anySignalEnabled &&
		(hasScored || hasSet);

	if (!canCompute) {
		c.semanticRelatedRequestId++;
		c.semanticRelatedLastThreshold = threshold;
		c.semanticRelatedLastZeroShotMinScore = zeroShotMin;
		c.semanticRelatedLastUseLinks = useLinks;
		c.semanticRelatedLastUseTags = useTags;
		c.semanticRelatedLastTitleJwThreshold = titleThr;
		c.semanticRelatedLastSimilarityStoreRev = null;
		c.semanticRelatedLastTermSimilarityStoreRev = null;
		c.semanticRelatedLastBasePath = null;
		c.semanticRelatedLastBaseIndexedKey = null;
		const hadAny = !!c.semanticRelatedPaths || !!c.semanticRelatedScored;
		if (hadAny) {
			c.semanticRelatedPaths = null;
			c.semanticRelatedScored = null;
			c.draw();
		}
		if (force) {
			c.draw();
		}
		return;
	}

	const storesStable =
		c.semanticRelatedLastSimilarityStoreRev === similarityStoreRev &&
		c.semanticRelatedLastTermSimilarityStoreRev === termSimilarityStoreRev;
	const baseStable = String(c.semanticRelatedLastBasePath || "") === String(path || "");
	const baseIndexedStable = String(c.semanticRelatedLastBaseIndexedKey ?? "") === String(baseIndexedKey ?? "");
	if (
		!force &&
		c.semanticRelatedLastThreshold === threshold &&
		c.semanticRelatedLastZeroShotMinScore === zeroShotMin &&
		c.semanticRelatedLastUseLinks === useLinks &&
		c.semanticRelatedLastUseTags === useTags &&
		c.semanticRelatedLastTitleJwThreshold === titleThr &&
		storesStable &&
		baseStable &&
		baseIndexedStable
	) {
		return;
	}

	c.semanticRelatedLastThreshold = threshold;
	c.semanticRelatedLastZeroShotMinScore = zeroShotMin;
	c.semanticRelatedLastUseLinks = useLinks;
	c.semanticRelatedLastUseTags = useTags;
	c.semanticRelatedLastTitleJwThreshold = titleThr;
	c.semanticRelatedLastSimilarityStoreRev = similarityStoreRev;
	c.semanticRelatedLastTermSimilarityStoreRev = termSimilarityStoreRev;
	c.semanticRelatedLastBasePath = path;
	c.semanticRelatedLastBaseIndexedKey = baseIndexedKey;
	c.semanticRelatedPaths = null;
	c.semanticRelatedScored = null;
	c.semanticRelatedTermLastUpdatedAt = null;
	const requestId = ++c.semanticRelatedRequestId;
	if (hasScored) {
		void Promise.resolve(c.plugin?.getSemanticRelatedScoredForFile?.(path))
			.then((list: SemanticScoredPath[] | null | undefined) => {
				if (c.semanticRelatedRequestId !== requestId) return;
				if (c.semanticRelatedBasePath !== path) return;
				const scored = Array.isArray(list) ? list.filter((x) => x && typeof x.path === "string") : null;
				c.semanticRelatedScored = scored;
				c.semanticRelatedPaths = scored ? new Set(scored.map((x) => x.path)) : null;
				c.draw();
			})
			.catch(() => {
				// ignore
			});
	} else {
		void Promise.resolve(c.plugin?.getSemanticRelatedPathsForFile?.(path))
			.then((set: Set<string> | null | undefined) => {
				if (c.semanticRelatedRequestId !== requestId) return;
				if (c.semanticRelatedBasePath !== path) return;
				c.semanticRelatedPaths = set instanceof Set ? set : null;
				c.semanticRelatedScored = null;
				c.draw();
			})
			.catch(() => {
				// ignore
			});
	}
	c.draw();
}
