import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings-model";

describe("settings: defaults", () => {
	it("uses 0 as the default semantic and topic thresholds", () => {
		expect(DEFAULT_SETTINGS.similarityThreshold).toBeCloseTo(0);
		expect(DEFAULT_SETTINGS.similarityZeroShotMinScore).toBeCloseTo(0);
	});

	it("uses 1 as the default title similarity threshold", () => {
		expect(DEFAULT_SETTINGS.similarityTitleJwThreshold).toBe(1);
	});
});
