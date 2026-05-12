import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { entrySummaryComponents } from "../src/ui/epoch-canvas-utils";
import {
	SUMMARY_ICON_ATTACHMENT,
	SUMMARY_ICON_PARSED,
	SUMMARY_ICON_RECURRING,
	SUMMARY_ICON_TRACKED_MODIFIED,
	SUMMARY_ICON_PIN
} from "../src/ui/epoch-canvas-constants";

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2025-01-01",
	file: overrides.file ?? "folder/note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
	summary: overrides.summary ?? "",
	source: overrides.source ?? "tracked",
	hidden: overrides.hidden,
	pinned: overrides.pinned,
		trackedChange: overrides.trackedChange ?? "modified",
		trackedTime: overrides.trackedTime
});

describe("entry summary icons", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

	it("shows only the pin icon for pinned tracked entries", () => {
		const entry = makeEntry({ pinned: true, trackedChange: "modified" });
		const { iconIds } = entrySummaryComponents(entry);
		expect(iconIds).toEqual([SUMMARY_ICON_PIN]);
	});

	it("shows only the pin icon for pinned parsed entries", () => {
		const entry = makeEntry({ pinned: true, source: "content" });
		const { iconIds } = entrySummaryComponents(entry);
		expect(iconIds).toEqual([SUMMARY_ICON_PIN]);
	});

	it("shows the parsed icon for filename-range namedate entries", () => {
		const entry = makeEntry({ source: "namedate" }) as any;
		entry.namedDateRange = true;
		const { iconIds } = entrySummaryComponents(entry);
		expect(iconIds).toEqual([SUMMARY_ICON_PARSED]);
	});

	it("keeps anchor note entries iconless", () => {
		expect(entrySummaryComponents(makeEntry({ source: "cdate", file: "note.md" })).iconIds).toEqual([]);
		expect(entrySummaryComponents(makeEntry({ source: "namedate", file: "note.md" })).iconIds).toEqual([]);
		expect(entrySummaryComponents(makeEntry({ source: "dateprop", file: "note.md" })).iconIds).toEqual([]);
	});

	it("renders icons for non-anchor entry types", () => {
		expect(entrySummaryComponents(makeEntry({ source: "content", file: "note.md" })).iconIds).toEqual([SUMMARY_ICON_PARSED]);
		expect(entrySummaryComponents(Object.assign(makeEntry({ source: "content", file: "note.md" }), { recurring: true }) as any).iconIds).toEqual([
		SUMMARY_ICON_RECURRING
	]);
		expect(entrySummaryComponents(makeEntry({ source: "tracked", trackedChange: "modified" })).iconIds).toEqual([
		SUMMARY_ICON_TRACKED_MODIFIED
	]);
		expect(
		entrySummaryComponents(
			makeEntry({ source: "epoch" as any, file: "epoch://day/2026-03-06-2026-03-06" } as any)
		).iconIds.length
	).toBeGreaterThan(0);
	});

	it("renders attachment icon for anchored attachments", () => {
		expect(entrySummaryComponents(makeEntry({ source: "cdate", file: "Assets/img.png" })).iconIds).toEqual([
		SUMMARY_ICON_ATTACHMENT
	]);
	});
});
