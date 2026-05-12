import { describe, it, expect, vi } from "vitest";
import { Platform } from "obsidian";

import { VIEW_TYPE_EPOCH } from "../src/ui/epoch-view-mode";
import { openEpochView } from "../src/plugin/view/leaf-actions";

describe("Open timeline command", () => {
	it("snaps to today when no open markdown file", async () => {
		(Platform as any).isMobileApp = false;

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
});
