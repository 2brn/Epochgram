import { describe, expect, it } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { selectTimelineEntries, pickTimelineEntryForFile } from "../src/ui/epoch-canvas-utils";

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2025-01-01",
	file: overrides.file ?? "note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
	summary: overrides.summary ?? "summary",
	source: overrides.source ?? "content",
	hidden: overrides.hidden,
	pinned: overrides.pinned,
	trackedChange: overrides.trackedChange,
	trackedTime: overrides.trackedTime
});

describe("timeline selection", () => {
	it("prefers the most recent tracked entry for a file", () => {
		const entries = [
			makeEntry({
				summary: "newer",
				source: "tracked",
				blockStart: 0,
				trackedTime: "2025-01-01T12:00:00.000Z"
			}),
			makeEntry({
				summary: "older",
				source: "tracked",
				blockStart: 50,
				trackedTime: "2025-01-01T08:00:00.000Z"
			})
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(1);
		expect(selected[0]?.summary).toBe("newer");
	});

	it("falls back to the first parsed date entry when no tracked entry exists", () => {
		const entries = [
			makeEntry({ summary: "earlier", source: "content", blockStart: 0 }),
			makeEntry({ summary: "later", source: "content", blockStart: 10 })
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(1);
		expect(selected[0]?.summary).toBe("earlier");
	});

	it("prefers named dates over created dates when neither tracked nor parsed dates exist", () => {
		const entries = [
			makeEntry({ summary: "created", source: "cdate" }),
			makeEntry({ summary: "named", source: "namedate" })
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(1);
		expect(selected[0]?.summary).toBe("named");
	});

	it("keeps one entry per file while preserving other files", () => {
		const entries = [
			makeEntry({ file: "a.md", summary: "first", source: "tracked", blockStart: 0 }),
			makeEntry({ file: "a.md", summary: "second", source: "tracked", blockStart: 5 }),
			makeEntry({ file: "b.md", summary: "content", source: "content" })
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(2);
		expect(selected.find(entry => entry.file === "a.md")?.summary).toBe("second");
		expect(selected.find(entry => entry.file === "b.md")?.summary).toBe("content");
	});

	it("orders selected entries by newest file mtime first", () => {
		const entries = [
			makeEntry({ file: "older.md", summary: "older", source: "content", fileMtimeMs: 100 }),
			makeEntry({ file: "newer.md", summary: "newer", source: "content", fileMtimeMs: 200 })
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(2);
		expect(selected.map((entry) => entry.file)).toEqual(["newer.md", "older.md"]);
	});

	it("prefers source priority before mdate when ordering selected entries", () => {
		const entries = [
			makeEntry({ file: "content-new.md", source: "content", fileMtimeMs: 500 }),
			makeEntry({ file: "tracked-old.md", source: "tracked", fileMtimeMs: 100 })
		];
		const selected = selectTimelineEntries(entries);
		expect(selected).toHaveLength(2);
		expect(selected.map((entry) => entry.file)).toEqual(["tracked-old.md", "content-new.md"]);
	});

	it("pickTimelineEntryForFile mirrors per-file selection", () => {
		const entries = [
			makeEntry({
				summary: "newer",
				source: "tracked",
				blockStart: 0,
				trackedTime: "2025-01-01T12:00:00.000Z"
			}),
			makeEntry({
				summary: "older",
				source: "tracked",
				blockStart: 5,
				trackedTime: "2025-01-01T08:00:00.000Z"
			})
		];
		const selected = pickTimelineEntryForFile(entries);
		expect(selected?.summary).toBe("newer");
	});
});
