import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedOptions: any = null;

vi.mock("../src/ui/modals/timeline-search-modal", () => {
	class TimelineSearchModal {
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

describe("Timeline search apply behavior", () => {
	beforeEach(() => {
		capturedOptions = null;
	});

	it("applies on commit (apply-only) and opens on record selection", () => {
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

		const setSearchQuery = vi.fn();
		view.canvas = {
			index: { "2020-01-01": [{}] },
			setSearchQuery
		};

		(view as any).openSearchModal();
		expect(capturedOptions).toBeTruthy();
		expect(typeof capturedOptions.onCommit).toBe("function");
		expect(typeof capturedOptions.onChooseRecord).toBe("function");

		// Apply-only (e.g. Alt+Enter in the modal).
		capturedOptions.onCommit("alpha");
		expect(setSearchQuery).toHaveBeenCalledWith("alpha");
		expect(openEntryAction).not.toHaveBeenCalled();
		expect(setSearchQuery).toHaveBeenCalledTimes(1);

		// Choosing a record opens (does not apply).
		capturedOptions.onChooseRecord(
			{ date: "2020-01-01", file: "notes/a.md", blockStart: 0, blockEnd: 1, summary: "", source: "content" },
			"alpha"
		);
		expect(setSearchQuery).toHaveBeenCalledTimes(1);
		expect(openEntryAction).toHaveBeenCalledTimes(1);

		capturedOptions.onCommit("");
		expect(setSearchQuery).toHaveBeenLastCalledWith("");
	});
});
