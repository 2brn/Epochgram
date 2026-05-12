import { describe, expect, it } from "vitest";
import { formatEpochSummaryForIndex } from "../src/plugin/epoch-summary-format";

describe("Epoch summary formatting", () => {
	it("splits sentences into separate lines", () => {
		const input = "First sentence. Second sentence! Third sentence?";
		expect(formatEpochSummaryForIndex(input)).toBe("First sentence\nSecond sentence\nThird sentence");
	});

	it("preserves line breaks", () => {
		const input = "First sentence.\nSecond sentence.";
		expect(formatEpochSummaryForIndex(input)).toBe("First sentence\nSecond sentence");
	});

	it("normalizes CRLF to LF", () => {
		const input = "First sentence.\r\nSecond sentence.";
		expect(formatEpochSummaryForIndex(input)).toBe("First sentence\nSecond sentence");
	});

	it("strips leading '* ' bullets before indexing", () => {
		const input = "* One. Two.";
		expect(formatEpochSummaryForIndex(input)).toBe("One\nTwo");
	});

	it("keeps long multi-sentence paragraphs as-is", () => {
		const input = "One. Two. Three. Four. Five. Six. Seven.";
		expect(formatEpochSummaryForIndex(input)).toBe("One\nTwo\nThree\nFour\nFive\nSix\nSeven");
	});

	it("strips leading meta prefixes", () => {
		expect(formatEpochSummaryForIndex("Note about Ski 2026, banking, taxes")).toBe("Ski 2026, banking, taxes");
		expect(formatEpochSummaryForIndex("Text covers: Ski 2026, banking, taxes")).toBe("Ski 2026, banking, taxes");
		expect(formatEpochSummaryForIndex("This entry — Ski 2026, banking, taxes")).toBe("Ski 2026, banking, taxes");
		expect(formatEpochSummaryForIndex("Noted: Ski 2026, banking, taxes")).toBe("Ski 2026, banking, taxes");
	});

	it("strips decorative leading/trailing punctuation", () => {
		expect(formatEpochSummaryForIndex("— \"Hello world.\"")).toBe("Hello world");
		expect(formatEpochSummaryForIndex("\"Hello world\" —")).toBe("Hello world");
	});

	it("replaces ':' with ',' on lines 2-3+", () => {
		const input = "Main: alpha.\nSecond: beta.\nThird: gamma.";
		expect(formatEpochSummaryForIndex(input)).toBe("Main: alpha\nSecond, beta\nThird, gamma");
	});

	it("replaces ';' with new lines (without duplicate new lines)", () => {
		const input = "Main: alpha; Second: beta.; Third: gamma.";
		expect(formatEpochSummaryForIndex(input)).toBe("Main: alpha\nSecond, beta\nThird, gamma");
	});

	it("does not create blank lines when ';' appears before a newline", () => {
		const input = "One;\nTwo.";
		expect(formatEpochSummaryForIndex(input)).toBe("One\nTwo");
	});
});
