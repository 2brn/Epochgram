import { describe, expect, it } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { selectTimelineEntries, pickTimelineEntryForFile } from "../src/ui/epoch-canvas-utils";
const entry = (overrides: Partial<DateEntry> = {}): DateEntry => ({ date: "2025-01-01", file: "note.md", blockStart: 0, blockEnd: 0, summary: "summary", source: "content", ...overrides });
describe("timeline selection", () => {
	it("selects the first parsed record per file", () => {
		const first = entry({ summary: "first" }), second = entry({ summary: "second", blockStart: 10 });
		expect(selectTimelineEntries([first, second])).toEqual([first]);
		expect(pickTimelineEntryForFile([first, second])).toBe(first);
	});
	it("prefers filename dates to creation dates", () => {
		const named = entry({ source: "namedate" });
		expect(pickTimelineEntryForFile([entry({ source: "cdate" }), named])).toBe(named);
	});
	it("keeps other files and orders records by newest mtime", () => {
		const old = entry({ file: "old.md", fileMtimeMs: 100 }), recent = entry({ file: "recent.md", fileMtimeMs: 200 });
		expect(selectTimelineEntries([old, recent, { ...old, blockStart: 5 }])).toEqual([recent, old]);
	});
	it("prioritizes content over anchors before sorting by mtime", () => {
		const content = entry({ file: "content.md", fileMtimeMs: 100 }), anchor = entry({ file: "anchor.md", source: "cdate", fileMtimeMs: 500 });
		expect(selectTimelineEntries([anchor, content])).toEqual([content, anchor]);
	});
	it("prioritizes pinned records over other records of the same file", () => {
		const pinned = entry({ pinned: true, blockStart: 5 });
		expect(pickTimelineEntryForFile([entry(), pinned])).toBe(pinned);
	});
	it("prefers ordinary content over recurring occurrences", () => {
		const content = entry(), recurring = entry({ recurring: true, blockStart: 5 });
		expect(pickTimelineEntryForFile([recurring, content])).toBe(content);
	});
});
