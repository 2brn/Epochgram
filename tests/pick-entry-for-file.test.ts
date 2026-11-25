import { describe, expect, it } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { pickEntryForFile } from "../src/ui/entry-helpers";
const canvas: any = { index: {}, showAttachments: true, showContentDates: true };
const entry = (blockStart: number, blockEnd: number, summary: string): DateEntry => ({ date: "2025-01-01", file: "note.md", blockStart, blockEnd, summary, source: "content" });
describe("pickEntryForFile", () => {
	it("prefers the entry whose block contains the cursor line", () => {
		const first = entry(0, 0, "first"), second = entry(50, 60, "second");
		expect(pickEntryForFile(canvas, [first, second], "note.md", 55)).toBe(second);
	});
	it("prefers the closest entry when no block contains the cursor line", () => {
		const first = entry(0, 10, "first"), second = entry(50, 60, "second");
		expect(pickEntryForFile(canvas, [first, second], "note.md", 40)).toBe(second);
	});
});
