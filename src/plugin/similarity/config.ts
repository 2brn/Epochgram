import type { EpochPlugin } from "../../main";
import { DEFAULT_SETTINGS } from "../../settings-model";
import { NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF } from "../../utils";

export const TITLE_SIMILARITY_MAX_LEN_DIFF = NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF;
export function getEffectiveSimilarityUseLinks(plugin: EpochPlugin): boolean {
	return plugin.settings.similarityUseLinks !== false;
}
export function getEffectiveSimilarityUseTags(plugin: EpochPlugin): boolean {
	return plugin.settings.similarityUseTags !== false;
}
export function getEffectiveTitleSimilarityThreshold(plugin: EpochPlugin): number {
	const value = Number(plugin.settings.similarityTitleJwThreshold ?? DEFAULT_SETTINGS.similarityTitleJwThreshold);
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
