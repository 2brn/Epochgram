import { PluginSettingTab, requireApiVersion, type App, type Setting } from "obsidian";
import type { EpochPlugin } from "./main";
export type { EpochSettings } from "./settings-model";
export { DEFAULT_SETTINGS } from "./settings-model";

import { defineGeneralViewSettings, defineIndexerSettings } from "./settings-ui/general";
import { defineMaintenanceSetting } from "./settings-ui/maintenance";
import { defineAdvancedSettings } from "./settings-ui/advanced";
import { renderLegacySettings, type SettingSection } from "./settings-ui/setting-definitions";

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

	private refreshDisplay(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.renderLegacyDisplay();
	}

	override getSettingDefinitions(): SettingSection[] {
		const { app, plugin } = this;
		const refresh = () => this.refreshDisplay();
		return [
			{ type: "group", items: defineGeneralViewSettings(plugin) },
			{
				type: "group",
				heading: "Indexer",
				items: [...defineIndexerSettings(plugin), defineMaintenanceSetting(app, plugin, refresh)]
			},
			...defineAdvancedSettings(this.containerEl, app, plugin, refresh),
			{
				type: "group",
				items: [{
					name: `Version ${plugin.manifest?.version ?? "Unknown"}`,
					searchable: false,
					render: (setting) => this.renderVersion(setting)
				}]
			}
		];
	}

	override display(): void {
		this.renderLegacyDisplay();
	}

	private renderLegacyDisplay(): void {
		this.containerEl.empty();
		renderLegacySettings(this.containerEl, this.getSettingDefinitions());
	}

	private renderVersion(versionSetting: Setting): void {
		versionSetting.addButton((button) => {
			button.buttonEl.classList.add("epoch-community-button");
			button
				.setButtonText("Reddit community")
				.onClick(() => {
					openExternalUrl("https://www.reddit.com/r/Epochgram/");
				});
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
