import { Setting, type SettingDefinitionRender } from "obsidian";
import { createSettingGroup } from "./setting-groups";

export type SettingRow = Omit<SettingDefinitionRender, "render"> & {
	render(setting: Setting): void | (() => void);
};

export type SettingSection = {
	type: "group";
	heading?: string;
	items: SettingRow[];
};

// Use the same definitions on Obsidian versions without native settings search.
export function renderLegacySettings(container: HTMLElement, sections: SettingSection[]): void {
	for (const { heading, items } of sections) {
		const { itemsEl } = createSettingGroup(container, heading);
		for (const item of items) {
			const setting = new Setting(itemsEl).setName(item.name);
			if (item.desc) setting.setDesc(item.desc);
			item.render(setting);
		}
	}
}
