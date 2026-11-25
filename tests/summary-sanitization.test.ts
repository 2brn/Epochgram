import { describe, expect, it } from "vitest";
import { sanitizeSummaryText } from "../src/utils";
import { makeSummary } from "../src/indexer/summarizer";

describe("Summary sanitization", () => {
	it("strips Unicode replacement character (U+FFFD)", () => {
		const input = "a\uFFFD b\uFFFDc";
		const out = sanitizeSummaryText(input);
		expect(out).toBe("a bc");
		expect(out).not.toContain("\uFFFD");
	});

	it("strips U+FFFD from local summaries", () => {
		const input = "hello\uFFFD world";
		const out = makeSummary(input, 2);
		expect(out).toBe("hello world");
		expect(out).not.toContain("\uFFFD");
	});

	it("falls back to original text when flattening removes everything", () => {
		const input = "🔥";
		const out = makeSummary(input, 5);
		expect(out).toBe("🔥");
	});

	it("does not count link arrow token in word limit", () => {
		const input = "https://example.com/path hello world";
		const out = makeSummary(input, 1);
		expect(out).toBe("↗︎ example.com/path...");
	});

	it("does not count checked task marker in word limit", () => {
		const input = "- [x] Завершити задачу сьогодні";
		const out = makeSummary(input, 1);
		expect(out).toBe("[x] Завершити...");
	});

	it("does not count unchecked task marker in word limit", () => {
		const input = "- [ ] Завершити задачу сьогодні";
		const out = makeSummary(input, 1);
		expect(out).toBe("[ ] Завершити...");
	});

});
