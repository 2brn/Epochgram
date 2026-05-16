import { describe, expect, it, vi } from "vitest";
import { App, TFile, WorkspaceLeaf } from "obsidian";

import { EpochView } from "../src/ui/epoch-view";

describe("EpochView active-file sync for non-md leaves", () => {
	it("uses active non-md leaf file instead of workspace.getActiveFile()", () => {
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

		const noteFile = new TFile("note.md", { extension: "md" });
		const imageFile = new TFile("photo.png", { extension: "png" });

		const leaf: any = new WorkspaceLeaf();
		leaf.app = plugin.app;
		const view: any = new EpochView(leaf, plugin);
		view.canvas = { setActiveFile: vi.fn() };
		view.syncCanvasActiveFile = vi.fn();
		view.openedAt = 0;
		view.startupRefocusDone = true;

		plugin.app.vault.getAbstractFileByPath = vi.fn((path: string) => (path === "photo.png" ? imageFile : null));
		plugin.app.workspace.activeLeaf = {
			view: {},
			getViewState: () => ({ state: { file: "photo.png" } })
		};
		plugin.app.workspace.getActiveFile = vi.fn(() => noteFile);

		view.updateActiveFile();

		expect(view.syncCanvasActiveFile).toHaveBeenCalledTimes(1);
		expect(view.syncCanvasActiveFile).toHaveBeenCalledWith(imageFile, { suppressFocus: false });
	});

	it("keeps non-md startup file instead of clearing to null when getActiveFile() is null", () => {
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

		const imageFile = new TFile("cover.jpg", { extension: "jpg" });

		const leaf: any = new WorkspaceLeaf();
		leaf.app = plugin.app;
		const view: any = new EpochView(leaf, plugin);
		view.canvas = { setActiveFile: vi.fn() };
		view.syncCanvasActiveFile = vi.fn();
		view.openedAt = 0;
		view.startupRefocusDone = true;

		plugin.app.vault.getAbstractFileByPath = vi.fn((path: string) => (path === "cover.jpg" ? imageFile : null));
		plugin.app.workspace.activeLeaf = {
			view: {},
			getViewState: () => ({ state: { file: "cover.jpg" } })
		};
		plugin.app.workspace.getActiveFile = vi.fn(() => null);

		view.updateActiveFile();

		expect(view.syncCanvasActiveFile).toHaveBeenCalledTimes(1);
		expect(view.syncCanvasActiveFile).toHaveBeenCalledWith(imageFile, { suppressFocus: false });
	});
});
