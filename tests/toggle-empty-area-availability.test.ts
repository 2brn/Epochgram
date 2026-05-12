import { beforeEach, describe, expect, it, vi } from "vitest";

import { toggleEmptyAreaView } from "../src/ui/menus/toggle-empty-area";
import { isGenerateEpochsEffective } from "../src/plugin/pro-feature-state";

vi.mock("../src/plugin/pro-feature-state", () => ({
	isGenerateEpochsEffective: vi.fn(() => true)
}));

describe("toggleEmptyAreaView availability checks", () => {
	beforeEach(() => {
		vi.mocked(isGenerateEpochsEffective).mockReturnValue(true);
	});

	it("enters epochs view on mobile when epochs are synced and user has pro access", () => {
		const setEpochsViewWithToolbar = vi.fn();
		vi.mocked(isGenerateEpochsEffective).mockReturnValue(false);
		const canvas: any = {
			plugin: {
				settings: { generateEpochs: true },
				indexer: {
					index: {
						"2026-04-18": [{ file: "epoch://week/2026-W16" }]
					}
				}
			},
			hasProAccess: () => true,
			requirePro: vi.fn(),
			isEpochsViewActive: () => false,
			setEpochsViewWithToolbar
		};

		toggleEmptyAreaView(canvas);

		expect(setEpochsViewWithToolbar).toHaveBeenCalledWith(true);
	});

	it("does not enter epochs view when index has non-epoch entries only", () => {
		const setEpochsViewWithToolbar = vi.fn();
		const canvas: any = {
			plugin: {
				settings: { generateEpochs: true },
				indexer: {
					index: {
						"2026-04-18": [{ file: "Notes/Today.md" }]
					}
				}
			},
			requirePro: vi.fn(),
			isEpochsViewActive: () => false,
			setEpochsViewWithToolbar
		};

		toggleEmptyAreaView(canvas);

		expect(setEpochsViewWithToolbar).not.toHaveBeenCalled();
	});

	it("requires pro when generation is not effective and no pro access", () => {
		const setEpochsViewWithToolbar = vi.fn();
		const requirePro = vi.fn();
		vi.mocked(isGenerateEpochsEffective).mockReturnValue(false);
		const canvas: any = {
			plugin: {
				settings: { generateEpochs: true },
				indexer: {
					index: {
						"2026-04-18": [{ file: "epoch://week/2026-W16" }]
					}
				}
			},
			hasProAccess: () => false,
			requirePro,
			isEpochsViewActive: () => false,
			setEpochsViewWithToolbar
		};

		toggleEmptyAreaView(canvas);

		expect(requirePro).toHaveBeenCalledWith("Epochs");
		expect(setEpochsViewWithToolbar).not.toHaveBeenCalled();
	});
});
