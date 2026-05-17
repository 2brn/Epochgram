import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";

vi.mock("../src/ui/modals/edit-summary-modal", () => ({
	promptEditSummary: vi.fn()
}));

import { promptEditSummary } from "../src/ui/modals/edit-summary-modal";
import { addEditSummary } from "../src/ui/menus/summary-menu/entry-actions";

function findItem(menu: Menu, title: string): any {
	return (menu.items as any[]).find((item) => item && item.kind !== "separator" && item.title === title);
}

describe("Edit summary menus write YAML description", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("record context menu writes YAML description and clears file summary state", async () => {
		vi.mocked(promptEditSummary).mockResolvedValue("Frontmatter summary");
		const menu = new Menu();
		const entry: any = {
			file: "folder/note.md",
			summary: "Visible summary"
		};
		const plugin: any = {
			app: {},
			settings: { summaryWordsCount: 10 },
			getYamlDescriptionForPath: vi.fn(async () => ""),
			setYamlDescriptionForPath: vi.fn(async () => true),
			persistIndex: vi.fn(async () => {}),
			indexer: {
				clearFileSummaryState: vi.fn(() => true)
			}
		};
		const state: any = {
			plugin,
			clearHover: vi.fn(),
			refreshIndex: vi.fn()
		};

		addEditSummary(menu as any, state, entry, "Note");

		const item = findItem(menu, "Edit summary…");
		expect(item).toBeTruthy();
		await item.onClickCb();

		expect(plugin.setYamlDescriptionForPath).toHaveBeenCalledWith("folder/note.md", "Frontmatter summary");
		expect(plugin.indexer.clearFileSummaryState).toHaveBeenCalledWith("folder/note.md");
		expect(plugin.persistIndex).toHaveBeenCalledWith({ skipEnsure: true });
		expect(state.refreshIndex).toHaveBeenCalled();
	});
});
