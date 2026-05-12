import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings-model";

describe("settings: enable animation", () => {
	it("defaults to enabled", () => {
		expect(DEFAULT_SETTINGS.enableAnimation).toBe(true);
	});
});
