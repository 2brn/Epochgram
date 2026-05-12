import { describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";

import { viewMethods } from "../src/plugin/view";

describe("openTimelineSearch does not snap timeline", () => {
	it("does not call snapInitialPosition when an epoch leaf already exists", async () => {
		Platform.isMobileApp = false;
		Platform.isDesktopApp = true;

		const snapInitialPosition = vi.fn();
		const plugin: any = {
			ensureIndexLoaded: vi.fn().mockResolvedValue(undefined),
			app: {
				workspace: {
					getMostRecentLeaf: vi.fn().mockReturnValue(null),
					getLeavesOfType: vi.fn().mockImplementation((type: string) => {
						if (type === "epoch") return [{ view: { canvas: { snapInitialPosition }, openTimelineSearch: vi.fn() } }];
						if (type === "markdown") {
							return [
								{
									view: {
										file: { path: "A.md" },
										editor: { getCursor: () => ({ line: 12 }) }
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

		await viewMethods.openTimelineSearch.call(plugin);

		expect(snapInitialPosition).not.toHaveBeenCalled();
	});
});
