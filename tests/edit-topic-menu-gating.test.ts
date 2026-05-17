import { describe, expect, it } from "vitest";
import { Menu } from "obsidian";
import { addEditTopic } from "../src/ui/menus/summary-menu/topic-menu";
import { withTrustedPro } from "./helpers/trusted-pro";

function findEditTopicItem(menu: any): any {
	return (menu.items as any[]).find((x) => x && x.kind !== "separator" && typeof x.title === "string" && x.title.startsWith("Set topic"));
}

describe("Edit topic menu gating", () => {
	it("does not add Topic item in Free", () => {
		const menu = new Menu();
		const state: any = {
			hasProAccess: () => false,
			requirePro: () => {},
			plugin: { settings: { similarityZeroShotMinScore: 0.9 } }
		};
		const entry: any = { file: "a.md" };

		addEditTopic(menu as any, state, entry, "A");

		const item = findEditTopicItem(menu as any);
		expect(item).toBeUndefined();
	});

	it("does not add Topic item when topic threshold is disabled", () => {
		const menu = new Menu();
		const plugin: any = {
			settings: { similarityZeroShotMinScore: 0 },
			manifest: { version: "0.4.3-test" }
		};
		withTrustedPro(plugin, "0.4.3-test");
		const state: any = {
			hasProAccess: () => true,
			requirePro: () => {},
			plugin
		};
		const entry: any = { file: "a.md" };

		addEditTopic(menu as any, state, entry, "A");

		const item = findEditTopicItem(menu as any);
		expect(item).toBeUndefined();
	});

	it("enables 'Topic' when Pro and topic threshold enabled", () => {
		const menu = new Menu();
		const plugin: any = {
			settings: { similarityZeroShotMinScore: 0.9 },
			manifest: { version: "0.4.3-test" }
		};
		withTrustedPro(plugin, "0.4.3-test");
		const state: any = {
			hasProAccess: () => true,
			requirePro: () => {},
			plugin
		};
		const entry: any = { file: "a.md" };

		addEditTopic(menu as any, state, entry, "A");

		const item = findEditTopicItem(menu as any);
		expect(item).toBeTruthy();
		expect(item.title).toBe("Set topic…");
		expect(item.disabled).toBe(false);
	});
});
