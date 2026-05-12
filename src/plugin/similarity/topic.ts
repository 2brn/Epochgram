import type { EpochPlugin } from "../../main";
import { isAutoTopicTerm, isNoTopicSentinel } from "../../utils";
import { isTopicSimilarityEnabled } from "./config";
import { now } from "./time";

export function getEmbeddingTermForPath(plugin: EpochPlugin, filePath: string): string {
	if (!isTopicSimilarityEnabled(plugin)) return "";
	try {
		const data = (plugin.indexer as any).getFileIndexData?.(filePath) ?? null;
		const embeddingTerm = typeof (data as any)?.embeddingTerm === "string" ? String((data as any).embeddingTerm).trim() : "";
		if (embeddingTerm && isNoTopicSentinel(embeddingTerm)) return "";
		return embeddingTerm;
	} catch {
		return "";
	}
}

export function getTermVocabulary(plugin: EpochPlugin): { terms: string[]; sig: string } {
	try {
		const idx: any = (plugin as any)?.indexer;
		const indexed: unknown = idx.getIndexedPaths();
		const paths: string[] = Array.isArray(indexed) ? indexed : [];
		const set = new Set<string>();
		for (const p of paths) {
			const t = String(idx.getFileEmbeddingTerm(p) || "").trim();
			if (t && !isNoTopicSentinel(t) && isAutoTopicTerm(t)) set.add(t);
		}
		const terms = Array.from(set).sort((a, b) => a.localeCompare(b));
		const sig = terms.join("\n");
		try {
			const anyPlugin: any = plugin as any;
			const prev = String(anyPlugin.termVocabularySig ?? "");
			if (prev !== sig) {
				anyPlugin.termVocabularySig = sig;
				anyPlugin.termVocabularyUpdatedAt = now();
				try {
					anyPlugin.termSimilarityPendingFiles = new Set<string>();
					anyPlugin.termSimilarityQueueTotal = 0;
					anyPlugin.termSimilarityQueueProcessed = 0;
					anyPlugin.termSimilarityStartedAt = 0;
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}
		return { terms, sig };
	} catch {
		return { terms: [], sig: "" };
	}
}
