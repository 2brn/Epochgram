import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DateEntry } from "../src/indexer/types";
import { isDraggableAnchorEntry } from "../src/ui/epoch-canvas-events/anchor-dnd";

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2026-03-06",
	file: overrides.file ?? "note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
	summary: overrides.summary ?? "",
	source: overrides.source ?? "namedate",
	pinned: overrides.pinned,
	originalDate: (overrides as any).originalDate,
	recurring: (overrides as any).recurring,
	fromFrontmatter: (overrides as any).fromFrontmatter,
	namedDateRange: (overrides as any).namedDateRange
});

describe("Anchor drag-and-drop eligibility", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-06T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows dragging a normal anchored note entry (no icons)", () => {
		const entry = makeEntry({ source: "namedate", file: "note.md", pinned: false, date: "2026-03-06" });
		expect(isDraggableAnchorEntry(entry)).toBe(true);
	});

	it("disallows dragging filename-range day entries (they render with the parsed icon)", () => {
		const entry: any = makeEntry({ source: "namedate", file: "note.md", date: "2026-03-07" });
		entry.namedDateRange = true;
		expect(isDraggableAnchorEntry(entry)).toBe(false);
	});

	it("disallows dragging anchored attachment entries (they render with an attachment icon)", () => {
		const entry = makeEntry({ source: "cdate", file: "Assets/img.png" });
		expect(isDraggableAnchorEntry(entry)).toBe(false);
	});

	it("allows dragging pinned anchors when the anchor is actually on Today", () => {
		const entry = makeEntry({ source: "dateprop", file: "note.md", pinned: true, date: "2026-03-06" });
		expect(isDraggableAnchorEntry(entry)).toBe(true);
	});

	it("disallows dragging pinned-today clones (synthetic pinned entries)", () => {
		const entry = makeEntry({ source: "dateprop", file: "note.md", pinned: true, date: "2026-03-06" }) as any;
		entry.originalDate = "2026-03-01";
		expect(isDraggableAnchorEntry(entry)).toBe(false);
	});
});
