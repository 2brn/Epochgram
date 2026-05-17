import { describe, expect, it, vi } from "vitest";
import { VIEW_TYPE_EPOCH } from "../src/ui/epoch-view-mode";
import { viewMethods } from "../src/plugin/view";

describe("epoch view startup", () => {
	it("creates an epoch view leaf when missing", async () => {
		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			app: {
				workspace: {
					getLeavesOfType: vi.fn().mockReturnValue([]),
					getRightLeaf: vi.fn().mockReturnValue({ setViewState })
				}
			}
		};

		await viewMethods.ensureEpochViewLeaf.call(plugin);

		expect(plugin.app.workspace.getLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE_EPOCH);
		expect(plugin.app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPOCH, active: false });
	});

	it("does nothing when an epoch view leaf already exists", async () => {
		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			app: {
				workspace: {
					getLeavesOfType: vi.fn().mockReturnValue([{}]),
					getRightLeaf: vi.fn().mockReturnValue({ setViewState })
				}
			}
		};

		await viewMethods.ensureEpochViewLeaf.call(plugin);

		expect(plugin.app.workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(setViewState).not.toHaveBeenCalled();
	});

	it("creates a tab leaf when Show in sidebar is off", async () => {
		const setViewState = vi.fn().mockResolvedValue(undefined);
		const plugin: any = {
			settings: {
				showInSidebar: false
			},
			app: {
				workspace: {
					getLeavesOfType: vi.fn().mockReturnValue([]),
					getRightLeaf: vi.fn().mockReturnValue({ setViewState }),
					getLeaf: vi.fn().mockReturnValue({ setViewState })
				}
			}
		};

		await viewMethods.ensureEpochViewLeaf.call(plugin);

		expect(plugin.app.workspace.getLeaf).toHaveBeenCalledWith(true);
		expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_EPOCH, active: false });
	});
});
