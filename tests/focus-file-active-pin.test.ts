import { beforeEach, describe, expect, test, vi } from "vitest";

const pinEntry = {
	date: "2020-01-01",
	file: "notes/hidden.md",
	blockStart: 0,
	blockEnd: 0,
	summary: "Hidden record",
	source: "cdate" as const
};

const recurringEntry = {
	date: "2025-01-02",
	file: pinEntry.file,
	blockStart: 1,
	blockEnd: 1,
	summary: "Recurring record",
	source: "content" as const,
	recurring: true
};

vi.mock("../src/ui/entry-helpers", () => ({
	getEntriesForDate: vi.fn((canvas: any, date: Date) => {
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		return Array.isArray(canvas.index?.[key]) ? canvas.index[key] : [];
	}),
	pickEntryForFile: vi.fn((_canvas: any, entries: any, filePath: string) => {
		const list = Array.isArray(entries) ? entries : [];
		return list.find((entry) => entry?.file === filePath) ?? null;
	})
}));

import { focusFile, snapToFile } from "../src/ui/epoch-canvas-focus";
import * as entryHelpers from "../src/ui/entry-helpers";

function makeCanvas(options: { index?: Record<string, any[]>; activeFileTimelineEntry?: any } = {}): any {
	const index = options.index ?? { "2020-01-01": [pinEntry] };
	return {
		index,
		plugin: {
			indexer: {
				index,
				getFileIndexData: () => ({
					namedDate: null,
					dateProp: null,
					cdate: pinEntry
				})
			}
		},
		activeFileTimelineEntry: options.activeFileTimelineEntry ?? null,
		layouts: [],
		scale: 1,
		offsetY: 0,
		targetScale: 1,
		targetOffsetY: 0,
		animatingView: false,
		pendingVisibilityDraw: false,
		keepHoverUntilPointerMove: false,
		root: { getBoundingClientRect: () => ({ width: 800, height: 800 }) },
		draw: vi.fn(),
		scheduleVisibilityCheck: vi.fn(),
		cancelFocusClear: vi.fn(),
		clearHover: vi.fn(),
		requestHoverAnimation: vi.fn(),
		clearSummaryHover: vi.fn(),
		getTodayOffset: () => 400,
		getToday: () => new Date(2025, 0, 1),
		getDateForIndex: (_index: number, today: Date) => today,
		hoverDateIndex: null,
		hoverSummary: null,
		hoverTarget: 0,
		hoverAnim: 0,
		animDateIndex: null,
		animSummary: null,
		focusClearHandle: null,
		scrollNavAnchorEntry: null,
		scrollNavAnchorDayIndex: null
	};
}

describe("active-file pin focus", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("keeps an explicitly selected timeline record as the active focus target", () => {
		const canvas = makeCanvas({ activeFileTimelineEntry: pinEntry });

		expect(focusFile(canvas, pinEntry.file, null, false)).toBe(true);
		expect(entryHelpers.pickEntryForFile).not.toHaveBeenCalled();
		expect(canvas.animatingView).toBe(true);
		expect(canvas.targetOffsetY).not.toBe(0);
		expect(canvas.scrollNavAnchorEntry).toBe(pinEntry);
	});

	test("keeps an explicitly selected timeline record for initial positioning", () => {
		const canvas = makeCanvas({ activeFileTimelineEntry: pinEntry });

		expect(snapToFile(canvas, pinEntry.file, null, { draw: false })).toBe(true);
		expect(entryHelpers.pickEntryForFile).not.toHaveBeenCalled();
		expect(canvas.offsetY).not.toBe(0);
		expect(canvas.scrollNavAnchorEntry).toBe(pinEntry);
	});

	test("initial positioning prefers the nearest visible recurrence over the cdate anchor", () => {
		const canvas = makeCanvas({
			index: {
				[pinEntry.date]: [pinEntry],
				[recurringEntry.date]: [recurringEntry]
			}
		});

		expect(snapToFile(canvas, pinEntry.file, null, { draw: false })).toBe(true);
		expect(entryHelpers.pickEntryForFile).toHaveBeenCalled();
		expect(canvas.scrollNavAnchorEntry).toBe(recurringEntry);
	});
});
