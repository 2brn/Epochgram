import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let capturedOptions: any = null;

vi.mock("../src/ui/modals/timeline-search-modal", () => {
	class TimelineSearchModal {
		public onClose: (() => void) | undefined;
		constructor(_app: any, options: any) {
			capturedOptions = options;
		}
		open() {}
	}
	return { TimelineSearchModal };
});

const openEntryAction = vi.fn(async () => {});
vi.mock("../src/ui/epoch-canvas-actions", () => {
	return {
		openEntry: (...args: any[]) => (openEntryAction as any)(...args)
	};
});

import { App, WorkspaceLeaf } from "obsidian";
import { EpochView } from "../src/ui/epoch-view";

describe("Timeline search suggestion selection", () => {
	beforeEach(() => {
		capturedOptions = null;
		openEntryAction.mockClear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("scrolls (does not snap) when choosing a suggestion", async () => {
		const plugin: any = {
			app: new App(),
			settings: {},
			viewPreferences: {},
			hasProAccess: vi.fn(() => false),
			timelineSearchIndex: { searchFileIdsRanked: vi.fn(() => []) }
		};

		const leaf: any = new WorkspaceLeaf();
		leaf.app = plugin.app;

		const view: any = new EpochView(leaf, plugin);
		view.updateSearchControl = vi.fn();
		view.scheduleSearchControlLayout = vi.fn();

		const focusFiltered = vi.fn(() => true);
		const setActiveFile = vi.fn(() => {});
		view.canvas = {
			index: { "2020-01-01": [{}] },
			setSearchQuery: vi.fn(),
			focusFilteredTimelineRecordForFile: focusFiltered,
			setActiveFile
		};

		(view as any).openSearchModal();
		expect(capturedOptions).toBeTruthy();
		expect(typeof capturedOptions.onChooseRecord).toBe("function");

		capturedOptions.onChooseRecord(
			{ date: "2020-01-01", file: "notes/a.md", blockStart: 12, blockEnd: 15, summary: "", source: "content" },
			"alpha"
		);

		expect(focusFiltered).toHaveBeenCalledWith("notes/a.md");
		expect(setActiveFile).toHaveBeenCalledWith("notes/a.md", 12, { suppressFocus: true });
		expect(openEntryAction).toHaveBeenCalledTimes(1);
	});
});
