import { describe, expect, it } from "vitest";
import { Menu } from "obsidian";
import { addReviewSubmenu } from "../src/ui/menus/summary-menu/entry-actions";

function firstRealItem(menu: Menu): any {
	return (menu as any).items.find((x: any) => x && x.kind !== "separator");
}

function realItemTitles(menu: Menu): string[] {
	return ((menu as any).items as any[])
		.filter((x: any) => x && x.kind !== "separator")
		.map((x: any) => String(x.title ?? ""));
}

describe("Review submenu normalization", () => {
	it("shows Reviewed when current state is capitalized", () => {
		const menu = new Menu();
		const state: any = { hasProAccess: () => true, plugin: { indexer: {} }, clearHover() {}, refreshIndex() {} };
		const entry: any = { file: "a.md" };

		addReviewSubmenu(menu as any, state, entry, "Reviewed" as any);

		expect(realItemTitles(menu)).toEqual(["Draft", "Hide"]);
	});

	it("applies state and closes the menu", async () => {
		let setPath: string | null = null;
		let setState: string | null = null;
		let hideCalled = false;

		const menu = new Menu();
		menu.onHide(() => {
			hideCalled = true;
		});

		const state: any = {
			hasProAccess: () => true,
			clearHover() {},
			refreshIndex() {},
			plugin: {
				indexer: {
					setEntryReviewState: (e: any, s: string) => {
						setPath = String(e?.file ?? "") || null;
						setState = s;
						return true;
					}
				},
				persistIndex: async () => {}
			}
		};
		const entry: any = { file: "Folder/note.md" };

		addReviewSubmenu(menu as any, state, entry, "draft" as any);

		const root = firstRealItem(menu);
		expect(root.title).toBe("Review");
		root.onClickCb();
		await Promise.resolve();
		await Promise.resolve();

		expect(setPath).toBe("Folder/note.md");
		expect(setState).toBe("reviewed");
		expect(hideCalled).toBe(true);
	});
});
