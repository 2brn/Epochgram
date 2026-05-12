import { describe, it, expect, vi } from "vitest";
import { refreshEpochViews } from "../src/plugin/view/leaf-actions";

describe("refreshEpochViews search query sync", () => {
	it("does not call syncSearchQueryFromPlugin()", () => {
		const view: any = {
			syncPreferencesFromPlugin: vi.fn(),
			refreshIndex: vi.fn(),
			canvas: {
				refreshSemanticRelatedForActiveFile: vi.fn()
			}
		};
		const leaf: any = { view };

		const plugin: any = {
			indexReady: true,
			viewPreferences: {
				reviewFilterMode: "reviewed+draft",
				showAttachments: false,
				showTrackedChanges: true,
				parsedFilterMode: "parsed",
				showEpochsView: false
			},
			app: {
				workspace: {
					getLeavesOfType: vi.fn(() => [leaf])
				}
			}
		};

		refreshEpochViews(plugin);

		expect(view.syncSearchQueryFromPlugin).toBeUndefined();
		expect(view.canvas.refreshSemanticRelatedForActiveFile).toHaveBeenCalledTimes(1);
		expect(view.canvas.refreshSemanticRelatedForActiveFile).toHaveBeenCalledWith(false);
	});

	it("can force semantic-related refresh", () => {
		const view: any = {
			syncPreferencesFromPlugin: vi.fn(),
			refreshIndex: vi.fn(),
			canvas: {
				refreshSemanticRelatedForActiveFile: vi.fn()
			}
		};
		const leaf: any = { view };

		const plugin: any = {
			indexReady: true,
			viewPreferences: {
				reviewFilterMode: "reviewed+draft",
				showAttachments: false,
				showTrackedChanges: true,
				parsedFilterMode: "parsed",
				showEpochsView: false
			},
			app: {
				workspace: {
					getLeavesOfType: vi.fn(() => [leaf])
				}
			}
		};

		refreshEpochViews(plugin, { forceSemanticRelated: true });

		expect(view.canvas.refreshSemanticRelatedForActiveFile).toHaveBeenCalledTimes(1);
		expect(view.canvas.refreshSemanticRelatedForActiveFile).toHaveBeenCalledWith(true);
	});
});
