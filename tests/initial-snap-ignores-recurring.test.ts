import { describe, expect, test, vi, beforeEach } from "vitest";

const nonRecurringOld = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const recurringNew = { file: "b.md", source: "content", blockStart: 2, blockEnd: 2, recurring: true };

const hoisted = vi.hoisted(() => {
	const keyFromLocalDate = (d: Date): string => {
		const yy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		return `${yy}-${mm}-${dd}`;
	};
	return {
		keyFromLocalDate,
		focusDate: vi.fn(() => true),
		getDayIndexForDate: vi.fn((_canvas: any, date: Date) => date.getDate())
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		buildMiniSearchQueryParts: vi.fn(() => ({
			includeText: "",
			excludeTokens: [],
			exactPhrases: [],
			excludedPhrases: [],
			hasAnySearch: false
		})),
		getEntriesForDate: vi.fn((canvas: any, date: Date) => {
			const key = hoisted.keyFromLocalDate(date);
			return Array.isArray(canvas.index?.[key]) ? canvas.index[key] : [];
		}),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, filePath: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === filePath) ?? null;
		})
	};
});

vi.mock("../src/ui/epoch-canvas-focus", async () => {
	const actual: any = await vi.importActual("../src/ui/epoch-canvas-focus");
	return {
		...actual,
		focusDate: hoisted.focusDate,
		getDayIndexForDate: hoisted.getDayIndexForDate
	};
});

import { focusFirstFilteredTimelineRecord, snapFirstFilteredTimelineRecord } from "../src/ui/epoch-canvas/scroll-nav-focus";

function makeCanvas(index: any): any {
	return {
		index,
		searchQuery: "",
		root: {
			getBoundingClientRect: () => ({ width: 800, height: 800 })
		},
		scale: 1,
		offsetY: 0,
		targetScale: 1,
		targetOffsetY: 0,
		animatingView: false,
		pendingScrollNavHighlight: null,
		scrollNavFile: null,
		scrollNavIndex: 0,
		scrollNavAnchorEntry: null,
		scrollNavAnchorDayIndex: null,
		hoverSummary: null,
		animSummary: null,
		hoverTarget: 0,
		draw: vi.fn(() => {})
	};
}

describe("initial snap ignores recurring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("snapFirstFilteredTimelineRecord picks nearest-to-today date", () => {
		const canvas = makeCanvas({
			"2026-03-01": [nonRecurringOld],
			"2026-04-10": [recurringNew]
		});
		const ok = snapFirstFilteredTimelineRecord(canvas as any, { draw: false });
		expect(ok).toBe(true);
		// Uses date.getDate() as mock dayIndex, so 1 is expected for 2026-03-01.
		expect(canvas.scrollNavAnchorDayIndex).toBe(1);
	});

	test("focusFirstFilteredTimelineRecord picks nearest-to-today date", () => {
		const canvas = makeCanvas({
			"2026-03-01": [nonRecurringOld],
			"2026-04-10": [recurringNew]
		});
		const ok = focusFirstFilteredTimelineRecord(canvas as any);
		expect(ok).toBe(true);
		expect(hoisted.focusDate).toHaveBeenCalledTimes(1);
		const calledWithDate = (hoisted.focusDate.mock.calls[0] as any[])[1] as Date;
		expect(hoisted.keyFromLocalDate(calledWithDate)).toBe("2026-03-01");
	});

	test("falls back to recurring-only when there are no normal records", () => {
		const canvas = makeCanvas({
			"2026-04-01": [recurringNew]
		});
		const ok = snapFirstFilteredTimelineRecord(canvas as any, { draw: false });
		expect(ok).toBe(true);
	});

	test("when only recurring records exist, snaps to nearest-to-today date", () => {
		const canvas = makeCanvas({
			"2026-04-01": [recurringNew],
			"2026-03-01": [{ ...recurringNew, file: "c.md" }]
		});
		const ok = snapFirstFilteredTimelineRecord(canvas as any, { draw: false });
		expect(ok).toBe(true);
		const calls = hoisted.getDayIndexForDate.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const calledWithDate = (calls[calls.length - 1] as any[])[1] as Date;
		expect(hoisted.keyFromLocalDate(calledWithDate)).toBe("2026-04-01");
	});
});
