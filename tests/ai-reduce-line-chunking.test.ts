import { describe, expect, it } from "vitest";
import { splitIntoAiChunksByLines } from "../src/plugin/ai-summaries/shared";

describe("ai reduce chunking by lines", () => {
	it("splits on line boundaries without cutting lines", () => {
		const text = "aaaa\nbbbb\ncccc\ndddd";
		const chunks = splitIntoAiChunksByLines(text, 10);
		expect(chunks).toEqual(["aaaa\nbbbb\n", "cccc\ndddd"]);
		for (const c of chunks) {
			expect(c.includes("aaab")).toBe(false);
			expect(c.includes("bbb c")).toBe(false);
		}
	});

	it("keeps a long single line intact in one chunk", () => {
		const text = "01234567890123456789";
		const chunks = splitIntoAiChunksByLines(text, 8);
		expect(chunks).toEqual([text]);
	});
});
