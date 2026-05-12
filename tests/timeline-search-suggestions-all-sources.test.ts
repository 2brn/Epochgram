import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { App, WorkspaceLeaf } from "obsidian";
import { EpochView } from "../src/ui/epoch-view";

function makeView(overrides: { plugin?: any; canvas?: any } = {}) {
	const plugin: any = overrides.plugin ?? {
		app: new App(),
		settings: {},
		viewPreferences: {},
		hasProAccess: vi.fn(() => false)
	};

	const leaf: any = new WorkspaceLeaf();
	leaf.app = plugin.app;

	const view: any = new EpochView(leaf, plugin);
	view.updateSearchControl = vi.fn();
	view.scheduleSearchControlLayout = vi.fn();

	view.canvas = overrides.canvas ?? {
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: false,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: false,
		searchQuery: "",
		plugin
	};

	return { view, plugin };
}

describe("timeline search suggestions (all sources)", () => {
	beforeEach(() => {
		capturedOptions = null;
	});

	it("treats !marked as a marked-only filter query", () => {
		const plugin: any = {
			app: new App(),
			settings: {},
			viewPreferences: {},
			hasProAccess: vi.fn(() => false),
			// Make MiniSearch irrelevant for this test.
			timelineSearchIndex: { searchFileIdsRanked: vi.fn(() => []) }
		};
		const { view } = makeView({
			plugin,
			canvas: {
				index: {
					"2026-01-04": [
						{ date: "2026-01-04", file: "A.md", blockStart: 10, blockEnd: 10, summary: "", source: "content", markColor: 2 },
						{ date: "2026-01-04", file: "B.md", blockStart: 20, blockEnd: 20, summary: "", source: "content" }
					]
				},
				showAttachments: true,
				showTrackedChanges: true,
				showHidden: false,
				showDraftOnly: false,
				showContentDates: true,
				epochsView: false,
				searchQuery: "",
				plugin
			}
		});

		(view as any).openSearchModal();
		expect(capturedOptions).toBeTruthy();
		expect(typeof capturedOptions.getTopMatches).toBe("function");

		const matches = capturedOptions.getTopMatches("!marked", 5);
		expect(matches.length).toBe(1);
		expect(matches[0].entry.file).toBe("A.md");
	});

	it("falls back to entry fields when MiniSearch has no matches", () => {
		const emptySet = new Set<string>();
		const plugin: any = {
			app: new App(),
			settings: {},
			viewPreferences: {},
			hasProAccess: vi.fn(() => false),
			// Simulate a MiniSearch index that returns no matches.
			timelineSearchIndex: {
				searchFileIdsRanked: vi.fn(() => []),
				searchFileIds: vi.fn(() => emptySet)
			}
		};
		const { view } = makeView({
			plugin,
			canvas: {
				index: {
					"2026-01-04": [
						{ date: "2026-01-04", file: "A.md", blockStart: 10, blockEnd: 10, summary: "", aiSummary: "SpecialTerm", aiSummaryVisible: true, source: "content" }
					]
				},
				showAttachments: true,
				showTrackedChanges: true,
				showHidden: false,
				showDraftOnly: false,
				showContentDates: true,
				epochsView: false,
				searchQuery: "",
				plugin
			}
		});

		(view as any).openSearchModal();
		expect(capturedOptions).toBeTruthy();

		const matches = capturedOptions.getTopMatches("SpecialTerm", 5);
		expect(matches.length).toBe(1);
		expect(matches[0].entry.file).toBe("A.md");
	});

	it("does not include non-searchable recent paths when the input is empty", () => {
		const appAny: any = new App();
		appAny.workspace = {
			getActiveFile: () => null,
			getLastOpenFiles: () => ["MyFolder/", "A.md"]
		};
		const plugin: any = {
			app: appAny,
			settings: { showNoteNameInSummaryRows: false },
			viewPreferences: {},
			hasProAccess: vi.fn(() => false),
			// Make MiniSearch irrelevant for this test.
			timelineSearchIndex: { searchFileIdsRanked: vi.fn(() => []) }
		};
		const { view } = makeView({
			plugin,
			canvas: {
				index: {
					"2026-01-04": [
						{ date: "2026-01-04", file: "A.md", blockStart: 10, blockEnd: 10, summary: "", source: "content" },
						{ date: "2026-01-04", file: "B.md", blockStart: 20, blockEnd: 20, summary: "", source: "content" }
					]
				},
				showAttachments: true,
				showTrackedChanges: true,
				showHidden: false,
				showDraftOnly: false,
				showContentDates: true,
				epochsView: false,
				searchQuery: "",
				plugin
			}
		});

		(view as any).openSearchModal();
		expect(capturedOptions).toBeTruthy();
		const matches = capturedOptions.getTopMatches("", 5);
		expect(matches.some((m: any) => m?.entry?.file === "MyFolder/")).toBe(false);
		expect(matches.some((m: any) => m?.entry?.file === "A.md")).toBe(true);
	});
});
