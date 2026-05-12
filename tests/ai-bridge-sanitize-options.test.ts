import { describe, expect, it } from "vitest";

import { sanitizeBridgeOptions } from "../src/plugin/ai-bridge/sanitize";

describe("AI bridge sanitizeBridgeOptions", () => {
	it("defaults outputLanguage to en", () => {
		const o = sanitizeBridgeOptions(null);
		expect(o.summaryOutputLanguage).toBe("en");
		expect(o.summaryExpectedInputLanguages).toEqual(["en", "ja", "es"]);
		expect(o.summaryExpectedContextLanguages).toEqual(["en"]);
		expect(o.summaryType).toBe("headline");
		expect(o.summaryLength).toBe("long");
		expect(o.epochOutputLanguage).toBe("en");
		expect(o.epochExpectedInputLanguages).toEqual(["en", "ja", "es"]);
		expect(o.epochExpectedContextLanguages).toEqual(["en"]);
		expect(o.epochType).toBe("key-points");
		expect(o.epochLength).toBe("short");
	});

	it("accepts supported outputLanguage codes", () => {
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "en" }).summaryOutputLanguage).toBe("en");
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "es" }).summaryOutputLanguage).toBe("es");
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "ja" }).summaryOutputLanguage).toBe("ja");
	});

	it("normalizes region variants", () => {
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "es-MX" }).summaryOutputLanguage).toBe("es");
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "EN_us" }).summaryOutputLanguage).toBe("en");
	});

	it("falls back to en for unsupported languages", () => {
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "fr" }).summaryOutputLanguage).toBe("en");
		expect(sanitizeBridgeOptions({ summaryOutputLanguage: "" }).summaryOutputLanguage).toBe("en");
	});

	it("sanitizes expected language lists", () => {
		const o = sanitizeBridgeOptions({
			summaryExpectedInputLanguages: ["ja", "en", "fr", "ja"],
			summaryExpectedContextLanguages: ["es", "xx", "en"],
		});
		expect(o.summaryExpectedInputLanguages).toEqual(["ja", "en"]);
		expect(o.summaryExpectedContextLanguages).toEqual(["es", "en"]);
	});

	it("sanitizes summarizer type and length", () => {
		expect(sanitizeBridgeOptions({ summaryType: "tldr", summaryLength: "long" }).summaryType).toBe("tldr");
		expect(sanitizeBridgeOptions({ summaryType: "tldr", summaryLength: "long" }).summaryLength).toBe("long");
		expect(sanitizeBridgeOptions({ summaryType: "bogus", summaryLength: "bogus" }).summaryType).toBe("headline");
		expect(sanitizeBridgeOptions({ summaryType: "bogus", summaryLength: "bogus" }).summaryLength).toBe("long");
	});
});
