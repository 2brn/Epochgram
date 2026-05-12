import { NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "./utils";

export const RESET_PRO_SIMILARITY_THRESHOLD = 0.85;
export const RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE = 0.85;

export function applyProResetDefaults(settings: {
	similarityThreshold: number;
	similarityZeroShotMinScore?: number;
	similarityTitleJwThreshold?: number;
}): void {
	settings.similarityThreshold = RESET_PRO_SIMILARITY_THRESHOLD;
	settings.similarityZeroShotMinScore = RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE;
	settings.similarityTitleJwThreshold = NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
}
