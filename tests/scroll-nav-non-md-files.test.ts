import { describe, expect, it } from "vitest";
import type { EpochCanvas } from "../src/ui/epoch-canvas";
import type { DateEntry } from "../src/indexer/types";
import { snapToFile } from "../src/ui/epoch-canvas-focus";

const makeEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2025-01-01",
	file: overrides.file ?? "note.md",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? overrides.blockStart ?? 0,
	summary: overrides.summary ?? "summary",
	source: overrides.source ?? "namedate",
	hidden: overrides.hidden,
	pinned: overrides.pinned
});

function makeCanvas(args: {
	index: Record<string, DateEntry[]>;
	showAttachments?: boolean;
	showParsed?: boolean;
}): any {
	return {
		root: {
			getBoundingClientRect: () => ({ height: 1000, width: 1000 })
		},
		index: args.index,
		showAttachments: args.showAttachments ?? false,
		showContentDates: args.showParsed ?? false,
		showPropDates: args.showParsed ?? false,
		showTrackedChanges: false,
		showDrafts: false,
		showHidden: false,
		searchQuery: "",
		draw: () => {},
		plugin: {
			settings: {
				parseDatesInFrontmatter: false
			}
		},
		getToday: () => new Date(),
		get layouts() {
			return [];
		},
		scheduleVisibilityCheck: () => {},
		clearFocusedEpochRange: () => {}
	};
}

describe("snapToFile with non-md files (images)", () => {
	it("Issue 1: does not snap to image file when showAttachments is false", () => {
		const imageEntry = makeEntry({
			date: "2025-01-15",
			file: "photo.png",
			source: "namedate"
		});
		
		const canvas = makeCanvas({
			index: {
				"2025-01-15": [imageEntry]
			},
			showAttachments: false // Default: false
		}) as any;

		const result = snapToFile(canvas, "photo.png", null, { draw: false });
		expect(result).toBe(false);
	});

	it("Issue 1b: does not snap to image file when image is hidden by filters", () => {
		const imageEntry = makeEntry({
			date: "2025-01-15",
			file: "photo.png",
			source: "namedate"
		});
		
		const canvas = makeCanvas({
			index: {
				"2025-01-15": [imageEntry]
			},
			showAttachments: false,
			showParsed: false // Both showContentDates and showPropDates are false
		}) as any;

		const result = snapToFile(canvas, "photo.png", null, { draw: false });
		expect(result).toBe(false);
	});

	it("Issue 2: snaps to image file only when it is visible under the current filters", () => {
		const imageEntry = makeEntry({
			date: "2025-01-15",
			file: "photo.png",
			source: "namedate"
		});
		
		const noteEntry = makeEntry({
			date: "2025-01-10",
			file: "note.md",
			source: "namedate"  // Use namedate instead of content to avoid showContentDates filter
		});

		const canvas = makeCanvas({
			index: {
				"2025-01-10": [noteEntry],
				"2025-01-15": [imageEntry]
			},
			showAttachments: true,
			showParsed: true  // namedate stays visible, and attachment is visible too
		}) as any;

		const result1 = snapToFile(canvas, "photo.png", null, { draw: false });
		expect(result1).toBe(true);

		const result2 = snapToFile(canvas, "note.md", null, { draw: false });
		expect(result2).toBe(true);

		const result3 = snapToFile(canvas, "photo.png", null, { draw: false });
		expect(result3).toBe(true);
	});

	it("does not snap to image on reload when the image is hidden by filters", () => {
		const imageEntry = makeEntry({
			date: "2025-01-15",
			file: "photo.png",
			source: "namedate"
		});

		const todayEntry = makeEntry({
			date: new Date().toISOString().split("T")[0],
			file: "today.md",
			source: "content"
		});

		const canvas = makeCanvas({
			index: {
				[new Date().toISOString().split("T")[0]]: [todayEntry],
				"2025-01-15": [imageEntry]
			},
			showAttachments: false
		}) as any;

		const result = snapToFile(canvas, "photo.png", null, { draw: false });
		expect(result).toBe(false);
	});
});
