import { describe, expect, it, vi } from "vitest";
import {
	setActiveFile,
	setActiveFileTimelineEntry
} from "../src/ui/epoch-canvas/active-file";

function entry(file: string, date: string): any {
	return { file, date, blockStart: 0, blockEnd: 0, source: "content" };
}

function makeCanvas(): any {
	return {
		activeFilePath: "old.md",
		activeFileTimelineEntry: entry("old.md", "2020-01-01"),
		pendingActiveFileTimelineEntry: null,
		pendingActiveFileFocus: null,
		suppressNextFocusScroll: "new.md",
		focusedEpochRange: null,
		index: {},
		scrollNavFile: null,
		scrollNavIndex: -1,
		pendingScrollNavHighlight: null,
		scrollNavAnchorEntry: null,
		scrollNavAnchorDayIndex: null,
		showContentDates: true,
		showPropDates: true,
		showAttachments: true,
		showDraftOnly: false,
		showHidden: false,
		reviewFilterMode: "reviewed+draft",
		root: { matches: () => false },
		suppressNextFocusHover: null,
		forceNextFocusHover: null,
		requestHoverAnimation: vi.fn(),
		refreshSemanticRelatedForActiveFile: vi.fn(),
		isEpochsViewActive: () => false,
		focusFile: vi.fn(() => false),
		resetScrollNavToToday: vi.fn(),
		snapInitialPosition: vi.fn(),
		isPointerDeviceEvent: () => true,
		clearHover: vi.fn(),
		draw: vi.fn(),
		scheduleVisibilityCheck: vi.fn()
	};
}

describe("active timeline entry transitions", () => {
	it("keeps the old active pin stable until an opened file becomes active", () => {
		const canvas = makeCanvas();
		const clicked = entry("new.md", "2010-01-01");

		setActiveFileTimelineEntry(canvas, clicked);

		expect(canvas.activeFileTimelineEntry).toMatchObject({ file: "old.md" });
		expect(canvas.pendingActiveFileTimelineEntry).toBe(clicked);
		expect(canvas.requestHoverAnimation).not.toHaveBeenCalled();

		setActiveFile(canvas, "new.md", 0, { suppressFocus: true });

		expect(canvas.activeFilePath).toBe("new.md");
		expect(canvas.activeFileTimelineEntry).toBe(clicked);
		expect(canvas.pendingActiveFileTimelineEntry).toBeNull();
		expect(canvas.requestHoverAnimation).toHaveBeenCalledTimes(1);
	});
});
