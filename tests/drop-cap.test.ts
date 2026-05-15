import { describe, expect, test } from "vitest";
import { splitLeadByStopWordsOrPunctuation } from "../src/ui/drop-cap";

describe("drop-cap lead boundary", () => {
	test("does not include punctuation in prefix", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation("Checklist, and Italy '25 Diary");
		expect(prefix).toBe("Checklist");
		expect(rest.startsWith(",")).toBe(true);
	});

	       test("stops at stop-word from second word onward", () => {
		       const { prefix, rest } = splitLeadByStopWordsOrPunctuation("Payment Provider Checklist and Italy");
		       expect(prefix).toBe("Payment Provider Checklist");
		       expect(rest.startsWith("and ")).toBe(true);
	       });

	test("stops on second-word stop-word", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation("Alpha and Beta");
		expect(prefix).toBe("Alpha");
		expect(rest.startsWith("and ")).toBe(true);
	});

	test("if first line has punctuation, prefers punctuation over stop-words", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(
			"Payment Provider Checklist and Italy: 2025 Diary"
		);
		expect(prefix).toBe("Payment Provider Checklist and Italy");
		expect(rest.startsWith(":")).toBe(true);
	});

	test("stops at punctuation after numeric token", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(
			"Skiing in Italy in 2025: Diary entries | rest text"
		);
		expect(prefix).toBe("Skiing in Italy in 2025");
		expect(rest.startsWith(":"))
			.toBe(true);
	});

	test("stops at ':' after parenthesized year", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(
			"The Sacrament (2013): Documentary-style | rest of text"
		);
		expect(prefix).toBe("The Sacrament (2013)");
		expect(rest.startsWith(":"))
			.toBe(true);
	});

	test("stops at sentence-ending period before next sentence", () => {
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(
			"Román Карпінець shared contact details. Epochgram is a personal knowledge tool under development."
		);
		expect(prefix).toBe("Román Карпінець shared contact details");
		expect(rest.startsWith(".")).toBe(true);
		expect(rest.includes("Epochgram is a personal knowledge tool")).toBe(true);
	});

	test("sentence-ending period beats later comma", () => {
		const text =
			"Epochs now allow manual epoch creation. Automated summary generation from timelines is enabled. Epochs editing was updated. Draft Skitour notes from March 6-8, 2026 exist";
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(text);
		expect(prefix).toBe("Epochs now allow manual epoch creation");
		expect(rest.startsWith(".")).toBe(true);
		expect(rest.includes("Automated summary generation")).toBe(true);
	});

	test("caps prefix to max words even when comma appears later", () => {
		const text =
			"Obsidian plugin Epochgram generates visual timelines of notes with AI processing and features like summaries, while other topics discussed include Ardupilot";
		const { prefix, rest } = splitLeadByStopWordsOrPunctuation(text, undefined, { maxWords: 6 });
		expect(prefix).toBe("Obsidian plugin Epochgram generates visual timelines");
		expect(rest.startsWith("of ")).toBe(true);
	});
});
