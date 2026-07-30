import type { EpochPlugin } from "../../main";
import { DEFAULT_SETTINGS } from "../../settings-model";
import { NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF } from "../../utils";
import { getEffectiveSimilarityThreshold, getEffectiveZeroShotMinScore, hasSimilarityAccess } from "../pro-feature-state";

export const DEFAULT_SIMILARITY_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_ZERO_SHOT_MODEL = "MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33";

export const NO_SIMILARITY_MODEL = "__epoch_no_similarity_model__";

export const TITLE_SIMILARITY_THRESHOLD = DEFAULT_SETTINGS.similarityTitleJwThreshold;
export const TITLE_SIMILARITY_MAX_LEN_DIFF = NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF;

export const SIMILARITY_CONTENT_MAX_CHARS = 1000;

// Topic (zero-shot) classification runs much slower than embeddings; use a shorter,
// structured excerpt to keep inference fast.
export const TOPIC_CANDIDATE_MAX_CHARS = 450;

export function isSimilarityEnabled(plugin: EpochPlugin): boolean {
	try {
		return hasSimilarityAccess(plugin);
	} catch {
		return false;
	}
}

export function isTopicSimilarityEnabled(plugin: EpochPlugin): boolean {
	if (!isSimilarityEnabled(plugin)) return false;
	try {
		const rawModel = plugin.settings?.similarityZeroShotModelId;
		if (rawModel === NO_SIMILARITY_MODEL) return false;
	} catch {
		// ignore
	}
	try {
		const min = getEffectiveZeroShotMinScore(plugin);
		// 0 disables topics.
		return min > 0 && min < 1;
	} catch {
		return true;
	}
}

export function embeddingsAllowed(): boolean {
	return true;
}

export function getSimilarityModelId(plugin: EpochPlugin): string {
	try {
		const rawAny = plugin.settings?.similarityEmbeddingModelId;
		if (rawAny === NO_SIMILARITY_MODEL) return DEFAULT_SIMILARITY_MODEL;
		const raw = String(rawAny ?? "").trim();
		if (raw) return raw;
	} catch {
		// ignore
	}
	return DEFAULT_SIMILARITY_MODEL;
}

export function getZeroShotModelId(plugin: EpochPlugin): string {
	try {
		const rawAny = plugin.settings?.similarityZeroShotModelId;
		if (rawAny === NO_SIMILARITY_MODEL) return DEFAULT_ZERO_SHOT_MODEL;
		const raw = String(rawAny ?? "").trim();
		if (raw) return raw;
	} catch {
		// ignore
	}
	return DEFAULT_ZERO_SHOT_MODEL;
}

export function embeddingsSimilarityEnabled(plugin: EpochPlugin): boolean {
	if (!isSimilarityEnabled(plugin)) return false;
	if (!embeddingsAllowed()) return false;
	try {
		const rawModel = plugin.settings?.similarityEmbeddingModelId;
		if (rawModel === NO_SIMILARITY_MODEL) return false;
	} catch {
		// ignore
	}
	const threshold = getEffectiveSimilarityThreshold(plugin);
	if (!(threshold > 0 && threshold < 1)) return false;
	return true;
}
