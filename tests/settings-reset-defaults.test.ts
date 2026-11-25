import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings-model";
describe("settings defaults", () => {
	it("enables links, tags and same-folder title similarity", () => {
		expect(DEFAULT_SETTINGS.similarityTitleJwThreshold).toBe(1);
		expect(DEFAULT_SETTINGS.similarityUseLinks).toBe(true);
		expect(DEFAULT_SETTINGS.similarityUseTags).toBe(true);
	});
	it("keeps ordinary summaries and manual calendar sync", () => {
		expect(DEFAULT_SETTINGS.summaryWordsCount).toBe(5);
		expect(DEFAULT_SETTINGS.calendarSyncPeriod).toBe("manual");
	});
});
