import type { EpochPlugin } from "../../main";
import { isAutoTopicTerm, isNoTopicSentinel } from "../../utils";
import { isTopicSimilarityEnabled } from "./config";
import { now } from "./time";

type TopicIndexDataLike = {
	embeddingTerm?: string;
};

type TopicIndexerLike = {
	getFileIndexData?: (path: string) => TopicIndexDataLike | null | undefined;
	getIndexedPaths: () => string[];
	getFileEmbeddingTerm: (path: string) => string | null | undefined;
};

type TopicPluginState = {
	termVocabularySig?: string;
	termVocabularyUpdatedAt?: number;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	termSimilarityStartedAt?: number;
};

export function getEmbeddingTermForPath(plugin: EpochPlugin, filePath: string): string {
	if (!isTopicSimilarityEnabled(plugin)) return "";
	try {
		const data = (plugin.indexer as TopicIndexerLike).getFileIndexData?.(filePath) ?? null;
		const embeddingTerm = typeof data?.embeddingTerm === "string" ? String(data.embeddingTerm).trim() : "";
		if (embeddingTerm && isNoTopicSentinel(embeddingTerm)) return "";
		return embeddingTerm;
	} catch {
		return "";
	}
}

export function getTermVocabulary(plugin: EpochPlugin): { terms: string[]; sig: string } {
	try {
		const idx = plugin.indexer as TopicIndexerLike;
		const paths = idx.getIndexedPaths();
		const set = new Set<string>();
		for (const p of paths) {
			const t = String(idx.getFileEmbeddingTerm(p) || "").trim();
			if (t && !isNoTopicSentinel(t) && isAutoTopicTerm(t)) set.add(t);
		}
		const terms = Array.from(set).sort((a, b) => a.localeCompare(b));
		const sig = terms.join("\n");
		try {
			const state = plugin as EpochPlugin & TopicPluginState;
			const prev = String(state.termVocabularySig ?? "");
			if (prev !== sig) {
				state.termVocabularySig = sig;
				state.termVocabularyUpdatedAt = now();
				try {
					state.termSimilarityPendingFiles = new Set<string>();
					state.termSimilarityQueueTotal = 0;
					state.termSimilarityQueueProcessed = 0;
					state.termSimilarityStartedAt = 0;
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
