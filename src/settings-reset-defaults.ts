export const RESET_PRO_SIMILARITY_THRESHOLD = 0.85;
export const RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE = 0.85;
export const RESET_PRO_TITLE_JW_THRESHOLD = 1;

export function applyProResetDefaults(settings: {
	similarityThreshold: number;
	similarityZeroShotMinScore?: number;
	similarityTitleJwThreshold?: number;
}): void {
	settings.similarityThreshold = RESET_PRO_SIMILARITY_THRESHOLD;
	settings.similarityZeroShotMinScore = RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE;
	settings.similarityTitleJwThreshold = RESET_PRO_TITLE_JW_THRESHOLD;
}
