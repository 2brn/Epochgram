import { describe, it, expect, vi } from "vitest";
import { App, WorkspaceLeaf } from "obsidian";
import { EpochView } from "../src/ui/epoch-view";

describe("EpochView search query sync", () => {
	it("syncPreferencesFromPlugin() does not modify the in-memory search query", () => {
		const plugin: any = {
			app: new App(),
			settings: {},
			viewPreferences: {
				reviewFilterMode: "reviewed+draft",
				showAttachments: false,
				showTrackedChanges: true,
				parsedFilterMode: "parsed",
				showEpochsView: false
			},
			hasProAccess: vi.fn(() => false)
		};

		const leaf: any = new WorkspaceLeaf();
		leaf.app = plugin.app;

		const view: any = new EpochView(leaf, plugin);
		view.canvas = {
			setReviewFilterMode: vi.fn(),
			setShowAttachments: vi.fn(),
			setShowTrackedChanges: vi.fn(),
			setShowContentDates: vi.fn(),
			setEpochsView: vi.fn(),
			setSearchQuery: vi.fn()
		};

		// Keep this test focused on the search-query sync.
		view.updateFilterButtons = vi.fn();
		view.refreshSyncedEpochAvailability = vi.fn();
		view.updateProUiState = vi.fn();
		view.isEpochsEnabled = vi.fn(() => false);

		view.searchQuery = "some query";

		view.syncPreferencesFromPlugin(plugin.viewPreferences);

		expect(view.searchQuery).toBe("some query");
		expect(view.canvas.setSearchQuery).toHaveBeenCalledTimes(0);
	});
});
