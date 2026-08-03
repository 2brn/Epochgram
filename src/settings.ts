import {
	App,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type { EpochPlugin } from "./main";
export type { EpochSettings } from "./settings-model";
export { DEFAULT_SETTINGS } from "./settings-model";

import { renderGeneralViewSettings, renderIndexerSettings } from "./settings-ui/general";
import { renderMaintenanceSettings } from "./settings-ui/maintenance";
import { renderProPanel } from "./settings-ui/pro";
import { createSettingGroup } from "./settings-ui/setting-groups";

type RuntimeWindowLike = Window & { require?: (id: string) => unknown };
type ElectronLike = { shell?: { openExternal?: (url: string) => Promise<void> | void } };
type EpochPluginWithSettingsTab = EpochPlugin & { __epochSettingTab?: EpochSettingTab };

function openExternalUrl(url: string): void {
	try {
		const electron = (window as RuntimeWindowLike)?.require?.("electron") as ElectronLike | undefined;
		if (electron?.shell?.openExternal) {
			void electron.shell.openExternal(url);
			return;
		}
	} catch {
		// ignore
	}
	try {
		window.open(url);
	} catch {
		// ignore
	}
}

export class EpochSettingTab extends PluginSettingTab {
	plugin: EpochPlugin;

	constructor(app: App, plugin: EpochPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		try {
			(plugin as EpochPluginWithSettingsTab).__epochSettingTab = this;
		} catch {
			// ignore
		}
	}

	getSettingDefinitions() {
		return [];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const version = String(this.plugin?.manifest?.version ?? "Unknown");

		const { itemsEl: generalItems } = createSettingGroup(containerEl);
		renderGeneralViewSettings(generalItems, this.plugin);

		const { itemsEl: indexerItems } = createSettingGroup(containerEl, "Indexer");

		renderProPanel(containerEl, this.app, this.plugin, () => this.display());
		try {
			const proGroup = containerEl.querySelector<HTMLElement>(":scope > .setting-group.epoch-pro-settings-group");
			if (proGroup && containerEl.firstElementChild !== proGroup) {
				containerEl.insertBefore(proGroup, containerEl.firstElementChild);
			}
		} catch {
			// ignore
		}
		renderIndexerSettings(indexerItems, this.plugin);
		renderMaintenanceSettings(indexerItems, this.app, this.plugin, () => this.display());

		const { itemsEl: versionItems } = createSettingGroup(containerEl);
		const versionSetting = new Setting(versionItems)
			.setName(`Version ${version}`);
		versionSetting.addButton((button) => {
			button
				.setButtonText("Reddit community")
				.onClick(() => {
					openExternalUrl("https://www.reddit.com/r/Epochgram/");
				});
			button.buttonEl?.classList?.add("epoch-pro-get-pro-button");
		});
		const changelogLink = versionSetting.descEl.createEl("a", {
			text: "Read the changelog.",
			href: "https://github.com/2brn/Epochgram/blob/main/CHANGELOG",
		});
		changelogLink.addEventListener("click", (evt) => {
			evt.preventDefault();
			openExternalUrl("https://github.com/2brn/Epochgram/blob/main/CHANGELOG");
		});
	}
}
