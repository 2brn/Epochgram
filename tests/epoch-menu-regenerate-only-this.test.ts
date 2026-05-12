import { describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";
import { addEpochMenuIfApplicable } from "../src/ui/menus/summary-menu/epoch-menu";
import { withTrustedPro } from "./helpers/trusted-pro";

function findItem(menu: any, title: string): any {
	return (menu.items as any[]).find((x) => x && x.kind !== "separator" && x.title === title);
}

describe("Epoch menu: regenerate", () => {
	it("regenerates only the selected epoch", () => {
		const menu = new Menu();
		const enqueueEpochsForDateKeys = vi.fn();
		const plugin: any = {
			app: {},
			settings: { generateEpochs: true },
			enqueueEpochsForDateKeys,
			persistIndex: vi.fn(),
			indexer: {
				index: {
					"2025-01-01": []
				}
			},
			manifest: { version: "0.4.3-test" }
		};
		withTrustedPro(plugin, "0.4.3-test");
		const state: any = {
			hasProAccess: () => true,
			requirePro: vi.fn(),
			clearHover: vi.fn(),
			refreshIndex: vi.fn(),
			plugin
		};
		const canvas: any = {};
		const entry: any = {
			source: "epoch",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			file: "epoch://year/2025-01-01-2025-12-31",
			summary: ""
		};

		const ok = addEpochMenuIfApplicable(menu as any, state, canvas, entry);
		expect(ok).toBe(true);

		const header = (menu.items as any[]).find((x) => x && x.kind !== "separator" && typeof x.title === "string" && x.title.startsWith("Epoch "));
		expect(header).toBeTruthy();
		expect(header.icon).toBe("hourglass");

		const regen = findItem(menu as any, "Regenerate…");
		expect(regen).toBeTruthy();
		expect(typeof regen.onClickCb).toBe("function");

		regen.onClickCb();

		expect(enqueueEpochsForDateKeys).toHaveBeenCalledTimes(1);
		const [keys, opts] = enqueueEpochsForDateKeys.mock.calls[0];
		expect(opts).toMatchObject({
			force: true,
			showNotice: true,
			buckets: ["year"]
		});
		expect(keys).toEqual(["2025-01-01"]);
	});

	it("uses the clicked day key when it is within the epoch range", () => {
		const menu = new Menu();
		const enqueueEpochsForDateKeys = vi.fn();
		const plugin: any = {
			app: {},
			settings: { generateEpochs: true },
			enqueueEpochsForDateKeys,
			persistIndex: vi.fn(),
			indexer: {
				index: {
					"2025-01-01": []
				}
			},
			manifest: { version: "0.4.3-test" }
		};
		withTrustedPro(plugin, "0.4.3-test");
		const state: any = {
			hasProAccess: () => true,
			requirePro: vi.fn(),
			clearHover: vi.fn(),
			refreshIndex: vi.fn(),
			plugin
		};
		const canvas: any = {};
		const entry: any = {
			source: "epoch",
			date: "2025-06-15",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			file: "epoch://year/2025-01-01-2025-12-31",
			summary: ""
		};

		const ok = addEpochMenuIfApplicable(menu as any, state, canvas, entry);
		expect(ok).toBe(true);

		const regen = findItem(menu as any, "Regenerate…");
		expect(regen).toBeTruthy();
		regen.onClickCb();

		expect(enqueueEpochsForDateKeys).toHaveBeenCalledTimes(1);
		const [keys, opts] = enqueueEpochsForDateKeys.mock.calls[0];
		expect(opts).toMatchObject({
			force: true,
			showNotice: true,
			buckets: ["year"]
		});
		expect(keys).toEqual(["2025-06-15"]);
	});
});
