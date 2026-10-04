import { beforeEach, describe, expect, test, vi } from "vitest";

const pinEntry = {
	date: "2020-01-01",
	file: "notes/hidden.md",
	blockStart: 0,
	blockEnd: 0,
	summary: "Hidden record",
	source: "cdate" as const
};

vi.mock("../src/ui/entry-helpers", () => ({
	getEntriesForDate: vi.fn(() => []),
	pickEntryForFile: vi.fn(() => null)
}));

import { focusFile, snapToFile } from "../src/ui/epoch-canvas-focus";
import * as entryHelpers from "../src/ui/entry-helpers";

function makeCanvas(): any {
	const index = { "2020-01-01": [pinEntry] };
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
		activeFileTimelineEntry: null,
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

	test("auto-scrolls to the active pin when timeline filters reject its record", () => {
		const canvas = makeCanvas();

		expect(focusFile(canvas, pinEntry.file, null, false)).toBe(true);
		expect(entryHelpers.pickEntryForFile).not.toHaveBeenCalled();
		expect(canvas.animatingView).toBe(true);
		expect(canvas.targetOffsetY).not.toBe(0);
		expect(canvas.scrollNavAnchorEntry).toBe(pinEntry);
	});

	test("uses the active pin for initial timeline positioning", () => {
		const canvas = makeCanvas();

		expect(snapToFile(canvas, pinEntry.file, null, { draw: false })).toBe(true);
		expect(entryHelpers.pickEntryForFile).not.toHaveBeenCalled();
		expect(canvas.offsetY).not.toBe(0);
		expect(canvas.scrollNavAnchorEntry).toBe(pinEntry);
	});
});
