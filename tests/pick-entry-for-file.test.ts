import { describe, expect, it } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { pickEntryForFile } from "../src/ui/entry-helpers";

const makeCanvas = (overrides: Record<string, unknown> = {}) =>
	({
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: false,
		...overrides
	}) as any;

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry =>
	({
		date: overrides.date ?? "2025-01-01",
		file: overrides.file ?? "note.md",
		blockStart: overrides.blockStart ?? 0,
		blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
		summary: overrides.summary ?? "summary",
		source: overrides.source ?? "tracked",
		hidden: overrides.hidden,
		pinned: overrides.pinned,
		trackedChange: overrides.trackedChange,
		trackedTime: overrides.trackedTime
	}) as DateEntry;

describe("pickEntryForFile", () => {
	it("prefers the entry whose block contains the cursor line", () => {
		const canvas = makeCanvas();
		const newer = makeEntry({
			source: "tracked",
			blockStart: 0,
			blockEnd: 0,
			trackedTime: "2025-01-01T12:00:00.000Z",
			summary: "newer"
		});
		const older = makeEntry({
			source: "tracked",
			blockStart: 50,
			blockEnd: 60,
			trackedTime: "2025-01-01T08:00:00.000Z",
			summary: "older"
		});

		const picked = pickEntryForFile(canvas, [newer, older], "note.md", 55);
		expect(picked?.summary).toBe("older");
	});

	it("prefers the closest entry when no block contains the cursor line", () => {
		const canvas = makeCanvas();
		const a = makeEntry({
			source: "tracked",
			blockStart: 0,
			blockEnd: 10,
			trackedTime: "2025-01-01T12:00:00.000Z",
			summary: "a"
		});
		const b = makeEntry({
			source: "tracked",
			blockStart: 50,
			blockEnd: 60,
			trackedTime: "2025-01-01T08:00:00.000Z",
			summary: "b"
		});

		const picked = pickEntryForFile(canvas, [a, b], "note.md", 40);
		expect(picked?.summary).toBe("b");
	});
});
