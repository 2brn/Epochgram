import { describe, expect, it } from "vitest";
import { getPinBadgeRects } from "../src/ui/epoch-pin-overlay";

function todayKey(): string {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateKeyDaysAgo(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() - days);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function makeCanvas(options: {
	activeFilePath: string | null;
	pinnedFile?: "date" | "dock" | null;
	paths?: string[];
	activeFileTimelineEntry?: unknown;
	offsetY?: number;
}): any {
	const entry = {
		date: todayKey(),
		file: "notes/current.md",
		blockStart: 0,
		blockEnd: 0,
		summary: "Current record",
		source: "cdate"
	};
	const style = { getPropertyValue: () => "" };
	const root = {
		clientHeight: 200,
		ownerDocument: { defaultView: { getComputedStyle: () => style } }
	};
	return {
		root,
		plugin: {
			indexer: {
				getIndexedPaths: () => options.paths ?? [],
				getFileIndexData: () => ({
					cdate: entry,
					namedDate: null,
					dateProp: null,
					pinnedFile: options.pinnedFile ?? null
				})
			}
		},
		activeFilePath: options.activeFilePath,
		activeFileTimelineEntry: options.activeFileTimelineEntry ?? null,
		semanticRelatedPaths: null,
		scale: 1,
		offsetY: options.offsetY ?? -1_000
	};
}

describe("active-file virtual dock pin", () => {
	it("docks the active file even when it has no persisted pin", () => {
		const rects = getPinBadgeRects(makeCanvas({ activeFilePath: "notes/current.md" }) as any);

		expect(rects).toHaveLength(1);
		expect(rects[0]).toMatchObject({ y1: 4, y2: 20 });
	});

	it("uses one dock badge when the active file already has a date pin", () => {
		const rects = getPinBadgeRects(makeCanvas({
			activeFilePath: "notes/current.md",
			pinnedFile: "date",
			paths: ["notes/current.md"]
		}) as any);

		expect(rects).toHaveLength(1);
		expect(rects[0]).toMatchObject({ y1: 4, y2: 20 });
	});

	it("uses the record date that opened the active file", () => {
		const clickedEntry = {
			date: dateKeyDaysAgo(10),
			file: "notes/current.md",
			blockStart: 10,
			blockEnd: 10,
			summary: "Clicked record",
			source: "content"
		};
		const rects = getPinBadgeRects(makeCanvas({
			activeFilePath: "notes/current.md",
			activeFileTimelineEntry: clickedEntry,
			offsetY: 80
		}) as any);

		expect(rects).toHaveLength(1);
		expect(rects[0]).toMatchObject({ y1: 180, y2: 196 });
	});
});
