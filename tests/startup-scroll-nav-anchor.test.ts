import { beforeEach, describe, expect, test, vi } from "vitest";

const entry0 = { file: "a.md", source: "content", blockStart: 0, blockEnd: 0 };
const entry10 = { file: "a.md", source: "content", blockStart: 10, blockEnd: 10 };
const entry11 = { file: "a.md", source: "content", blockStart: 11, blockEnd: 11 };
const entry5Recurring = { file: "a.md", source: "content", blockStart: 5, blockEnd: 5, recurring: true };
const entry12Recurring = { file: "a.md", source: "content", blockStart: 12, blockEnd: 12, recurring: true };

vi.mock("../src/ui/epoch-canvas-focus", () => {
	return {
		// Encode dayIndex directly into Date.getTime().
		dateKeyToDate: vi.fn((key: string) => {
			const m = String(key || "").match(/^d(\d+)$/);
			if (!m) return null;
			return new Date(Number(m[1]));
		}),
		getDayIndexForDate: vi.fn((_canvas: any, date: Date) => {
			return Number(date?.getTime?.() ?? 0);
		})
	};
});

vi.mock("../src/ui/entry-helpers", () => {
	return {
		getEntriesForDate: vi.fn((_canvas: any, date: Date) => {
			const idx = Number(date?.getTime?.() ?? 0);
			if (idx === 0) return [entry0];
			if (idx === 5) return [entry5Recurring];
			if (idx === 10) return [entry10];
			if (idx === 11) return [entry11];
			if (idx === 12) return [entry12Recurring];
			return [];
		}),
		pickEntryForFile: vi.fn((_canvas: any, entries: any, path: string) => {
			const list = Array.isArray(entries) ? entries : [];
			return list.find((e) => e?.file === path) ?? null;
		})
	};
});

import { setScrollNavTargetForFile } from "../src/ui/epoch-canvas/scroll-nav";

function makeCanvas(overrides: Partial<any> = {}): any {
	return {
		index: {
			d0: [entry0],
			d5: [entry5Recurring],
			d10: [entry10],
			d11: [entry11],
			d12: [entry12Recurring]
		},
		layouts: [],
		scrollNavIndex: -1,
		scrollNavFile: null,
		pendingScrollNavHighlight: null,
		...overrides
	};
}

describe("startup scroll-nav anchor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("sets scrollNavIndex to the best matching entry (latest date when equal priority)", () => {
		const canvas = makeCanvas();
		const ok = setScrollNavTargetForFile(canvas as any, "a.md", null);
		expect(ok).toBe(true);
		expect(canvas.scrollNavFile).toBe("a.md");
		// Day 12 is recurring, so we should anchor to the newest non-recurring match (day 11).
		expect(canvas.scrollNavIndex).toBe(3);
	});

	test("when only recurring matches exist, anchors to the oldest recurring", () => {
		const canvas = makeCanvas({
			index: {
				d12: [entry12Recurring]
			}
		});
		const ok = setScrollNavTargetForFile(canvas as any, "a.md", null);
		expect(ok).toBe(true);
		expect(canvas.scrollNavIndex).toBe(0);
	});

	test("when multiple recurring matches exist, anchors to the oldest recurring", () => {
		const canvas = makeCanvas({
			index: {
				d5: [entry5Recurring],
				d12: [entry12Recurring]
			}
		});
		const ok = setScrollNavTargetForFile(canvas as any, "a.md", null);
		expect(ok).toBe(true);
		// Oldest recurring day is d5; after sorting, it's index 0.
		expect(canvas.scrollNavIndex).toBe(0);
	});

	test("prefers a visible layout entry matching the cursor line", () => {
		const canvas = makeCanvas({
			layouts: [
				{
					index: 10,
					summaryRects: [{ entry: entry10 }]
				}
			]
		});
		const ok = setScrollNavTargetForFile(canvas as any, "a.md", 10);
		expect(ok).toBe(true);
		// With d5 recurring present, the sorted scroll-nav list is: d0, d5, d10, d11, d12.
		expect(canvas.scrollNavIndex).toBe(2);
	});
});
