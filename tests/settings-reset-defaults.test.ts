import { describe, expect, it } from "vitest";
import {
	applyProResetDefaults,
	RESET_PRO_SIMILARITY_THRESHOLD,
	RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE
} from "../src/settings-reset-defaults";
import { NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "../src/utils";

describe("settings: reset defaults", () => {
	it("applies Pro reset defaults (including semantic threshold 0.79)", () => {
		const settings = {
			similarityThreshold: 0,
			similarityZeroShotMinScore: 0,
			similarityTitleJwThreshold: 0
		};
		applyProResetDefaults(settings);

		expect(settings.similarityThreshold).toBeCloseTo(RESET_PRO_SIMILARITY_THRESHOLD);
		expect(settings.similarityZeroShotMinScore).toBeCloseTo(RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE);
		expect(settings.similarityTitleJwThreshold).toBeCloseTo(NOTE_TITLE_SIMILARITY_JW_THRESHOLD);
	});
});
