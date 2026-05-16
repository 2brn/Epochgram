import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { VIEW_TYPE_EPOCH } from "../src/ui/epoch-view-mode";
import { viewMethods } from "../src/plugin/view";

describe("epoch view open", () => {
	afterEach(() => {
		Platform.isMobileApp = false;
		Platform.isDesktopApp = true;
	});

	it("opens in a right leaf on desktop", async () => {
		Platform.isMobileApp = false;
		Platform.isDesktopApp = true;

		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			ensureIndexLoaded: vi.fn().mockResolvedValue(undefined),
			app: {
				workspace: {
					getMostRecentLeaf: vi.fn().mockReturnValue(null),
					getLeavesOfType: vi.fn().mockReturnValue([]),
					getRightLeaf: vi.fn().mockReturnValue({ setViewState }),
					revealLeaf: vi.fn(),
					setActiveLeaf: vi.fn()
				}
			}
		};

		await viewMethods.openEpochView.call(plugin);

		expect(plugin.app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPOCH, active: false });
	});

	it("opens via getLeaf(true) on mobile", async () => {
		Platform.isMobileApp = true;
		Platform.isDesktopApp = false;

		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			ensureIndexLoaded: vi.fn().mockResolvedValue(undefined),
			app: {
				workspace: {
					getMostRecentLeaf: vi.fn().mockReturnValue(null),
					getLeavesOfType: vi.fn().mockReturnValue([]),
					getRightLeaf: vi.fn().mockReturnValue(null),
					getLeaf: vi.fn().mockReturnValue({ setViewState }),
					revealLeaf: vi.fn(),
					setActiveLeaf: vi.fn()
				}
			}
		};

		await viewMethods.openEpochView.call(plugin);

		expect(plugin.app.workspace.getLeaf).toHaveBeenCalledWith(true);
		expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPOCH, active: false });
	});

	it("activates epoch view when openEpochView is called with activate option", async () => {
		Platform.isMobileApp = false;
		Platform.isDesktopApp = true;

		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			ensureIndexLoaded: vi.fn().mockResolvedValue(undefined),
			app: {
				workspace: {
					getMostRecentLeaf: vi.fn().mockReturnValue(null),
					getLeavesOfType: vi.fn().mockReturnValue([]),
					getRightLeaf: vi.fn().mockReturnValue({ setViewState }),
					revealLeaf: vi.fn(),
					setActiveLeaf: vi.fn()
				}
			}
		};

		await viewMethods.openEpochView.call(plugin, { activate: true });

		expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPOCH, active: true });
		expect(plugin.app.workspace.setActiveLeaf).toHaveBeenCalled();
	});
});
