import { beforeEach, describe, expect, test, vi } from "vitest";

const aEntry = { file: "a.md", source: "content", blockStart: 1, blockEnd: 1 };
const bEntry = { file: "b.md", source: "content", blockStart: 2, blockEnd: 2 };
const cEntry = { file: "c.md", source: "content", blockStart: 3, blockEnd: 3 };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn(() => true),
		findLayoutForDate: vi.fn(() => ({})),
		focusSummaryForEntry: vi.fn(() => true),
		dateKeyToDate: vi.fn((k: string) => {
			const m = /^\d{4}-\d{2}-\d{2}$/.test(String(k || "")) ? String(k) : "1970-01-01";
			const [y, mo, d] = m.split("-").map((v) => Number(v));
			return new Date(y, (mo || 1) - 1, d || 1);
		}),
		getDayIndexForDate: vi.fn((_canvas: any, date: Date) => {
			// Deterministic within this test file: Jan 1 -> 0, Jan 2 -> 1.
			return date instanceof Date ? Math.max(0, (date.getDate() || 1) - 1) : 0;
		}),
		isDateVisible: vi.fn(() => true)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn(() => [aEntry, bEntry, cEntry]),
		getEntriesCountForDateFast: vi.fn((_canvas: any, date: Date, options?: any) => {
			// When filtering by epochBucket, only return entries for "day".
			const bucket = String(options?.epochBucket || "");
			if (bucket && bucket !== "day") return 0;
			// Return 1 for any date to mark it as "has visible entries".
			return date instanceof Date && Number.isFinite(date.getTime()) ? 1 : 0;
		}),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		})
	};
});

import { advanceScrollNav } from "../src/ui/epoch-canvas/scroll-nav";
import * as focusMod from "../src/ui/epoch-canvas-focus";

function makeCanvas(overrides: Record<string, any> = {}): any {
	return {
		plugin: {
			__epochInheritedMarkSourceByPath: new Map<string, string>(),
			__epochInheritedMarkIndexByPath: new Map<string, number>()
		},
		index: { "2020-01-01": [{}, {}], "2020-01-02": [{}, {}] },
		layouts: [],
		root: { getBoundingClientRect: () => ({ height: 800 }) },
		offsetY: -5 * 48,
		scale: 1,
		activeFilePath: "a.md",
		semanticRelatedScored: [{ path: "b.md", score: 0.9 }],
		semanticRelatedBasePath: "a.md",
		clearFocusedEpochRange: vi.fn(),
		requestHoverAnimation: vi.fn(),
		focusFile: vi.fn(),
		hoverSummary: null,
		animSummary: null,
		hoverDateIndex: null,
		animDateIndex: null,
		hoverTarget: 0,
		pendingScrollNavHighlight: null,
		scrollNavIndex: -1,
		scrollNavFile: null,
		scrollNavAnchorEntry: aEntry,
		scrollNavAnchorDayIndex: null,
		searchQuery: "",
		showAttachments: true,
		showTrackedChanges: true,
		showContentDates: true,
		showHidden: true,
		showDraftOnly: false,
		epochsView: false,
		epochsViewBucket: null,
		...overrides
	};
}

describe("scroll nav uses visible targets when search active", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("active search query navigates through all visible records (not only similars)", () => {
		const focusDateMock = focusMod.focusDate as any;
		const canvas = makeCanvas({ searchQuery: "alpha" });
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		// date-based navigation should move to next visible day
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(focusDateMock).toHaveBeenCalledTimes(1);
		const focusedDate = focusDateMock.mock.calls[0]?.[1] as Date;
		expect(focusedDate.getFullYear()).toBe(2020);
		expect(focusedDate.getMonth()).toBe(0);
		expect(focusedDate.getDate()).toBe(2);
		expect((canvas as any).__forcedActiveFileCursorPath).toBeUndefined();
		expect((canvas as any).__forcedActiveFileCursorLine).toBeUndefined();
	});

	test("!marked navigates through all visible records (not only similars)", () => {
		const focusDateMock = focusMod.focusDate as any;
		const canvas = makeCanvas({ searchQuery: "!marked" });
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(focusDateMock).toHaveBeenCalledTimes(1);
		const focusedDate = focusDateMock.mock.calls[0]?.[1] as Date;
		expect(focusedDate.getFullYear()).toBe(2020);
		expect(focusedDate.getMonth()).toBe(0);
		expect(focusedDate.getDate()).toBe(2);
		expect((canvas as any).__forcedActiveFileCursorPath).toBeUndefined();
	});

	test("no opened file navigates through all visible records", () => {
		const focusDateMock = focusMod.focusDate as any;
		const canvas = makeCanvas({ activeFilePath: null, scrollNavFile: null, searchQuery: "" });
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(focusDateMock).toHaveBeenCalledTimes(1);
		const focusedDate = focusDateMock.mock.calls[0]?.[1] as Date;
		expect(focusedDate.getFullYear()).toBe(2020);
		expect(focusedDate.getMonth()).toBe(0);
		expect(focusedDate.getDate()).toBe(2);
		expect((canvas as any).__forcedActiveFileCursorPath).toBeUndefined();
	});

	test("epochs view navigates through all visible records", () => {
		const focusDateMock = focusMod.focusDate as any;
		const canvas = makeCanvas({
			epochsView: true,
			searchQuery: "",
			activeFilePath: "a.md",
			scrollNavAnchorDayIndex: 0
		});
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		expect(ok).toBe(true);
		// Epochs view uses day-based navigation (focusDate), not entry-based.
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(focusDateMock).toHaveBeenCalledTimes(1);
		const focusedDate = focusDateMock.mock.calls[0]?.[1] as Date;
		expect(focusedDate.getFullYear()).toBe(2020);
		expect(focusedDate.getMonth()).toBe(0);
		expect(focusedDate.getDate()).toBe(2);
		expect((canvas as any).__forcedActiveFileCursorPath).toBeUndefined();
	});

	test("epochs view respects epochsViewBucket when choosing visible days", () => {
		const focusDateMock = focusMod.focusDate as any;
		focusDateMock.mockClear();
		const canvas = makeCanvas({
			epochsView: true,
			epochsViewBucket: "month",
			activeFilePath: "a.md",
			scrollNavAnchorDayIndex: 0
		});
		const ok = advanceScrollNav(canvas, 1, { wrap: false });
		// With bucket != "day", our mocked getEntriesCountForDateFast returns 0 => no visible days.
		expect(ok).toBe(false);
		expect(focusDateMock).not.toHaveBeenCalled();
	});
});
