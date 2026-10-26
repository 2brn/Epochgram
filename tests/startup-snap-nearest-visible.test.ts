import { describe, expect, test, vi } from "vitest";

import { snapToFile } from "../src/ui/epoch-canvas-focus";

const file = "notes/open.md";
const cdate = {
	date: "2020-01-01",
	file,
	blockStart: 0,
	blockEnd: 0,
	summary: "Creation anchor",
	source: "cdate" as const
};

function entry(date: string, source: "namedate" | "dateprop" | "content" | "tracked" | "cdate", extras: Record<string, unknown> = {}): any {
	return {
		date,
		file,
		blockStart: 1,
		blockEnd: 1,
		summary: `${source} record`,
		source,
		...extras
	};
}

function makeCanvas(index: Record<string, any[]>, overrides: Record<string, unknown> = {}): any {
	return {
		index,
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
		getToday: () => new Date(2025, 0, 10),
		getDateForIndex: (_index: number, today: Date) => today,
		hoverDateIndex: null,
		hoverSummary: null,
		hoverTarget: 0,
		hoverAnim: 0,
		animDateIndex: null,
		animSummary: null,
		focusClearHandle: null,
		scrollNavAnchorEntry: null,
		scrollNavAnchorDayIndex: null,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: false,
		showDraftOnly: false,
		showContentDates: true,
		showPropDates: true,
		epochsView: false,
		searchQuery: "",
		...overrides
	};
}

describe("startup file snap", () => {
	test.each([
		["filename anchor", entry("2025-01-11", "namedate")],
		["frontmatter anchor", entry("2025-01-11", "dateprop")],
		["content date", entry("2025-01-11", "content")],
		["recurring occurrence", entry("2025-01-11", "content", { recurring: true })],
		["tracked change", entry("2025-01-11", "tracked")],
		["pinned record", entry("2025-01-11", "cdate", { pinned: true, originalDate: "2020-01-01" })]
	])("uses a visible nearest %s regardless of source", (_kind, candidate) => {
		const canvas = makeCanvas({
			[cdate.date]: [cdate],
			[candidate.date]: [candidate]
		});

		expect(snapToFile(canvas, file, null, { draw: false })).toBe(true);
		expect(canvas.scrollNavAnchorEntry).toBe(candidate);
	});

	test("skips a nearer record that is not visible under the current filters", () => {
		const hidden = entry("2025-01-10", "content", { reviewState: "hidden" });
		const visibleRecurring = entry("2025-01-11", "content", { recurring: true });
		const canvas = makeCanvas({
			[cdate.date]: [cdate],
			[hidden.date]: [hidden],
			[visibleRecurring.date]: [visibleRecurring]
		});

		expect(snapToFile(canvas, file, null, { draw: false })).toBe(true);
		expect(canvas.scrollNavAnchorEntry).toBe(visibleRecurring);
	});
});
