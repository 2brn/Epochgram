import { describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";

import { viewMethods } from "../src/plugin/view";

describe("openEpochView mobile snap even when cursor line unknown", () => {
	it("calls snapInitialPosition when open markdown line is null", async () => {
		Platform.isMobileApp = true;
		Platform.isDesktopApp = false;

		const snapInitialPosition = vi.fn();
		const plugin: any = {
			ensureIndexLoaded: vi.fn().mockResolvedValue(undefined),
			app: {
				workspace: {
					getMostRecentLeaf: vi.fn().mockReturnValue(null),
					getLeavesOfType: vi
						.fn()
						.mockImplementation((type: string) => {
							if (type === "epochgram") return [{ view: { canvas: { snapInitialPosition } } }];
							if (type === "markdown") {
								return [
									{
										view: {
											file: { path: "A.md" },
											editor: { getCursor: () => ({ line: undefined }) }
										}
									}
								];
							}
							return [];
						}),
					revealLeaf: vi.fn(),
					setActiveLeaf: vi.fn(),
					getRightLeaf: vi.fn(),
					getLeaf: vi.fn()
				}
			}
		};

		await viewMethods.openEpochView.call(plugin);

		expect(snapInitialPosition).toHaveBeenCalledTimes(1);
		expect(snapInitialPosition).toHaveBeenCalledWith("A.md", null);
	});
});
