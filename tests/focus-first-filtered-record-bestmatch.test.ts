import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		focusDate: vi.fn(() => true),
		focusFile: vi.fn(() => true),
		dateKeyToDate: vi.fn((key: string) => {
			const [y, m, d] = String(key).split("-").map((x) => Number(x));
			return new Date(y, (m || 1) - 1, d || 1);
		}),
		getDayIndexForDate: vi.fn(() => 0)
		,
		getSourcePriority: vi.fn(() => 2)
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		buildMiniSearchQueryParts: vi.fn(() => ({
			includeText: "env",
			excludeTokens: [],
			exactPhrases: [],
			excludedPhrases: [],
			hasAnySearch: true
		})),
		getEntriesForDate: vi.fn((_canvas: any, date: Date) => {
			const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
			if (key === "2020-01-02") return [{ file: "best.md", source: "content", blockStart: 1, blockEnd: 1 }];
			if (key === "2020-01-01") return [{ file: "other.md", source: "content", blockStart: 1, blockEnd: 1 }];
			return [];
		}),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		}),
		getEntriesCountForDateFast: vi.fn(() => 0)
	};
});

import { focusFirstFilteredTimelineRecord } from "../src/ui/epoch-canvas/scroll-nav";
import { focusDate, focusFile } from "../src/ui/epoch-canvas-focus";

function makeCanvas(): any {
	return {
		plugin: {
			timelineSearchIndex: {
				searchFileIdsRanked: vi.fn(() => ["best.md", "other.md"])
			}
		},
		index: {
			"2020-01-01": [{}],
			"2020-01-02": [{}]
		},
		root: { getBoundingClientRect: () => ({ width: 800, height: 800 }) },
		offsetY: 0,
		scale: 1,
		activeFilePath: "x.md",
		clearFocusedEpochRange: vi.fn(),
		pendingScrollNavHighlight: null,
		scrollNavIndex: -1,
		scrollNavFile: null,
		searchQuery: "env",
		showAttachments: true
	};
}

describe("focus first filtered timeline record (best match)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("uses ranked MiniSearch best match", () => {
		const canvas = makeCanvas();
		const ok = focusFirstFilteredTimelineRecord(canvas as any);
		expect(ok).toBe(true);
		expect((focusFile as any).mock.calls.length).toBe(0);
		expect((focusDate as any).mock.calls.length).toBe(1);
		const focused = (focusDate as any).mock.calls[0][1] as Date;
		expect(focused).toBeInstanceOf(Date);
		expect(focused.getFullYear()).toBe(2020);
		expect(focused.getMonth()).toBe(0);
		expect(focused.getDate()).toBe(2);
	});
});
