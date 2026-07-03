import { describe, it, expect, vi } from "vitest";
import { Platform } from "obsidian";

import { VIEW_TYPE_EPOCH } from "../src/ui/epoch-view-mode";
import { openEpochView } from "../src/plugin/view/leaf-actions";

describe("Open timeline command", () => {
	it("snaps to today when no open markdown file", async () => {
		(Platform as any).isMobile = false;

		const snapInitial = vi.fn(() => true);

		const leaf: any = {
			view: {
				getViewType: () => VIEW_TYPE_EPOCH,
				canvas: {
					snapInitialPosition: snapInitial
				}
			}
		};

		const workspace: any = {
			getMostRecentLeaf: () => null,
			getLeavesOfType: (type: string) => (type === VIEW_TYPE_EPOCH ? [leaf] : []),
			revealLeaf: vi.fn(),
			setActiveLeaf: vi.fn()
		};

		const plugin: any = {
			ensureIndexLoaded: vi.fn(async () => {}),
			app: { workspace },
			settings: {}
		};

		await openEpochView(plugin);
		expect(snapInitial).toHaveBeenCalledTimes(1);
	});

	it("snaps to opened non-md file when active leaf is non-markdown", async () => {
		(Platform as any).isMobile = false;

		const snapInitial = vi.fn(() => true);
		const imageFile = { path: "images/photo.png", extension: "png" };

		const leaf: any = {
			view: {
				getViewType: () => VIEW_TYPE_EPOCH,
				canvas: {
					snapInitialPosition: snapInitial
				}
			}
		};

		const activeLeaf: any = {
			view: { getViewType: () => "image" },
			getViewState: () => ({ state: { file: "images/photo.png" } })
		};

		const workspace: any = {
			activeLeaf,
			getMostRecentLeaf: () => activeLeaf,
			getLeavesOfType: (type: string) => (type === VIEW_TYPE_EPOCH ? [leaf] : []),
			revealLeaf: vi.fn(),
			setActiveLeaf: vi.fn()
		};

		const plugin: any = {
			ensureIndexLoaded: vi.fn(async () => {}),
			app: {
				workspace,
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => (path === "images/photo.png" ? imageFile : null))
				}
			},
			settings: {}
		};

		await openEpochView(plugin);

		expect(snapInitial).toHaveBeenCalledTimes(1);
		expect(snapInitial).toHaveBeenCalledWith("images/photo.png", null);
	});
});
