import { describe, expect, test, vi, beforeEach } from "vitest";

const nonRecurringOld = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const recurringNew = { file: "a.md", source: "content", blockStart: 2, blockEnd: 2, recurring: true };

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn(() => []),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, filePath: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === filePath) ?? null;
		})
	};
});

import { snapToFile } from "../src/ui/epoch-canvas-focus";
import { BASE_SPACING, FOCUS_ANCHOR_RATIO, MS_PER_DAY } from "../src/ui/epoch-canvas-constants";

function makeCanvas(index: any): any {
	return {
		index,
		layouts: [],
		scale: 1,
		offsetY: 0,
		targetScale: 1,
		targetOffsetY: 0,
		animatingView: false,
		pendingVisibilityDraw: false,
		keepHoverUntilPointerMove: false,
		root: {
			getBoundingClientRect: () => ({ width: 800, height: 800 })
		},
		draw: vi.fn(() => {}),
		scheduleVisibilityCheck: vi.fn(() => {}),
		cancelFocusClear: vi.fn(() => {}),
		clearHover: vi.fn(() => {}),
		requestHoverAnimation: vi.fn(() => {}),
		clearSummaryHover: vi.fn(() => {}),
		getTodayOffset: () => 400,
		getToday: () => new Date(2020, 0, 10),
		getTodayOffsetUnused: 0,
		getDateForIndex: (_i: number, today: Date) => today,
		hoverDateIndex: null,
		hoverSummary: null,
		hoverTarget: 0,
		hoverAnim: 0,
		animDateIndex: null,
		animSummary: null,
		focusClearHandle: null
	};
}

describe("file focus/snap ignores recurring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("snapToFile chooses the newer of (newest non-recurring, oldest recurring)", () => {
		const canvas = makeCanvas({
			"2020-01-01": [nonRecurringOld],
			"2020-01-02": [recurringNew]
		});
		const ok = snapToFile(canvas as any, "a.md", null, { draw: false });
		expect(ok).toBe(true);
			// Best date should be 2020-01-02 because it is newer than the non-recurring match.
			const today = new Date(2020, 0, 10);
			const bestNonRecurring = new Date(2020, 0, 1);
			const bestRecurring = new Date(2020, 0, 2);
			const dayIndexNonRecurring = Math.round((today.getTime() - bestNonRecurring.getTime()) / MS_PER_DAY);
			const dayIndexRecurring = Math.round((today.getTime() - bestRecurring.getTime()) / MS_PER_DAY);
			const worldYNonRecurring = dayIndexNonRecurring * BASE_SPACING;
			const worldYRecurring = dayIndexRecurring * BASE_SPACING;
			const anchorY = 800 * FOCUS_ANCHOR_RATIO;
			const expectedOffsetNonRecurring = anchorY - worldYNonRecurring;
			const expectedOffsetRecurring = anchorY - worldYRecurring;
			expect(canvas.offsetY).toBe(expectedOffsetRecurring);
			expect(canvas.offsetY).not.toBe(expectedOffsetNonRecurring);
	});

	test("snapToFile still prefers non-recurring when it is newer", () => {
		const canvas = makeCanvas({
			"2020-01-03": [{ ...nonRecurringOld, blockStart: 3, blockEnd: 3 }],
			"2020-01-01": [recurringNew]
		});
		const ok = snapToFile(canvas as any, "a.md", null, { draw: false });
		expect(ok).toBe(true);
		const today = new Date(2020, 0, 10);
		const bestNonRecurring = new Date(2020, 0, 3);
		const dayIndexNonRecurring = Math.round((today.getTime() - bestNonRecurring.getTime()) / MS_PER_DAY);
		const worldYNonRecurring = dayIndexNonRecurring * BASE_SPACING;
		const anchorY = 800 * FOCUS_ANCHOR_RATIO;
		const expectedOffsetNonRecurring = anchorY - worldYNonRecurring;
		expect(canvas.offsetY).toBe(expectedOffsetNonRecurring);
	});

	test("snapToFile falls back to recurring when it is the only match", () => {
		const canvas = makeCanvas({
			"2020-01-02": [recurringNew]
		});
		const ok = snapToFile(canvas as any, "a.md", null, { draw: false });
		expect(ok).toBe(true);
	});
});
