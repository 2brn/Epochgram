import { canonicalizeTopicTerm, isNoTopicSentinel } from "utils";
import { getMenuState } from "../menu-state";
import { getEffectiveZeroShotMinScore, hasSimilarityAccess } from "../../../plugin/pro-feature-state";
import { isTopicSimilarityEnabled } from "../../../plugin/similarity/config";

export async function getTopicGroupForPath(
	state: ReturnType<typeof getMenuState>,
	filePath: string
): Promise<{ term: string; paths: Set<string> } | null> {
	if (!hasSimilarityAccess((state as any).plugin)) return null;
	const plugin = (state as any).plugin;
	const indexer = plugin?.indexer;
	const p = String(filePath || "");
	if (!indexer || !p || p.startsWith("epoch://")) return null;

	const topicsEnabled = isTopicSimilarityEnabled(plugin);
	const minScore = topicsEnabled ? getEffectiveZeroShotMinScore(plugin) : 0;

	try {
		if (topicsEnabled) {
			await plugin?.ensureTermSimilarityStoreLoaded?.();
		}
	} catch {
		// ignore
	}

	let embeddingTerm = "";
	try {
		embeddingTerm = canonicalizeTopicTerm(String(indexer.getFileEmbeddingTerm(p) || "").trim());
	} catch {
		embeddingTerm = "";
	}
	if (embeddingTerm && isNoTopicSentinel(embeddingTerm)) return null;

	if (!topicsEnabled) {
		if (!embeddingTerm) return null;
		const paths = new Set<string>();
		paths.add(p);
		try {
			const indexedPaths: unknown = indexer.getIndexedPaths();
			const list = Array.isArray(indexedPaths) ? indexedPaths : [];
			for (const other of list) {
				if (!other || typeof other !== "string" || other.startsWith("epoch://")) continue;
				const t0 = String(indexer.getFileEmbeddingTerm(other) || "").trim();
				const t = canonicalizeTopicTerm(t0);
				if (!t) continue;
				if (isNoTopicSentinel(t)) continue;
				if (t === embeddingTerm) paths.add(other);
			}
		} catch {
			// ignore
		}
		return { term: embeddingTerm, paths };
	}

	if (!embeddingTerm) {
		try {
			const filesObj = plugin?.termSimilarityIndex?.files;
			const entry = filesObj && typeof filesObj === "object" ? (filesObj as any)[p] : null;
			const term = typeof entry?.term === "string" ? String(entry.term).trim() : "";
			const score = Number(entry?.score ?? 0);
			const ok = Number.isFinite(score) && score >= minScore;
			embeddingTerm = term && ok ? canonicalizeTopicTerm(term) : "";
		} catch {
			embeddingTerm = "";
		}
	}

	if (!embeddingTerm) return null;

	const paths = new Set<string>();
	paths.add(p);

	try {
		const indexedPaths: unknown = indexer.getIndexedPaths();
		const list = Array.isArray(indexedPaths) ? indexedPaths : [];
		for (const other of list) {
			if (!other || typeof other !== "string" || other.startsWith("epoch://")) continue;
			const t0 = String(indexer.getFileEmbeddingTerm(other) || "").trim();
			const t = canonicalizeTopicTerm(t0);
			if (!t) continue;
			if (isNoTopicSentinel(t)) continue;
			if (t === embeddingTerm) paths.add(other);
		}
	} catch {
		// ignore
	}

	try {
		const filesObj = plugin?.termSimilarityIndex?.files;
		if (filesObj && typeof filesObj === "object") {
			for (const [other, raw] of Object.entries(filesObj as any)) {
				if (!other || typeof other !== "string" || other.startsWith("epoch://")) continue;
				const term0 = typeof (raw as any)?.term === "string" ? String((raw as any).term).trim() : "";
				const term = canonicalizeTopicTerm(term0);
				if (!term || term !== embeddingTerm) continue;
				const score = Number((raw as any)?.score ?? 0);
				if (!Number.isFinite(score) || score < minScore) continue;
				const t0 = String(indexer.getFileEmbeddingTerm(other) || "").trim();
				const t = canonicalizeTopicTerm(t0);
				if (!t) {
					paths.add(other);
					continue;
				}
				if (isNoTopicSentinel(t)) continue;
				if (t !== embeddingTerm) continue;
				paths.add(other);
			}
		}
	} catch {
		// ignore
	}

	return { term: embeddingTerm, paths };
}
