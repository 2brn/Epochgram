import {
	App,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type { EpochPlugin } from "./main";
export type { EpochSettings } from "./settings-model";
export { DEFAULT_SETTINGS } from "./settings-model";

import { renderGeneralSettings } from "./settings-ui/general";
import { renderMaintenanceSettings } from "./settings-ui/maintenance";
import { renderProPanel } from "./settings-ui/pro";
import { createSettingGroup } from "./settings-ui/setting-groups";

declare const __EPOCHGRAM_BUILD_TIMESTAMP__: string;

function openExternalUrl(url: string): void {
	try {
		const electron = (window as any)?.require?.("electron");
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
			(plugin as any).__epochSettingTab = this;
		} catch {
			// ignore
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const version = String(this.plugin?.manifest?.version ?? "Unknown");
		const buildStamp = (() => {
			try {
				const raw = typeof __EPOCHGRAM_BUILD_TIMESTAMP__ === "string" ? __EPOCHGRAM_BUILD_TIMESTAMP__.trim() : "";
				if (!raw) return "unknown";
				if (/^\d{14}$/.test(raw)) return raw;
				const digits = raw.replace(/\D/g, "");
				if (digits.length >= 14) return digits.slice(0, 14);
				return "unknown";
			} catch {
				return "unknown";
			}
		})();

		const { itemsEl: generalItems } = createSettingGroup(containerEl);
		renderGeneralSettings(generalItems, this.plugin);
		renderMaintenanceSettings(generalItems, this.app, this.plugin, () => this.display());
		renderProPanel(containerEl, this.app, this.plugin, () => this.display());

		const { itemsEl: versionItems } = createSettingGroup(containerEl);
		const versionSetting = new Setting(versionItems)
			.setName(`Version ${version}`)
			.setDesc(`Build: ${buildStamp}`);
		versionSetting.addButton((button) => {
			button
				.setButtonText("Reddit community")
				.onClick(() => {
					openExternalUrl("https://www.reddit.com/r/Epochgram/");
				});
			button.buttonEl?.classList?.add("epoch-pro-get-pro-button");
		});
		versionSetting.descEl.createEl("br");
		const changelogLink = versionSetting.descEl.createEl("a", {
			text: "Read the changelog.",
			href: "https://github.com/2brn/epochgram/blob/main/CHANGELOG",
		});
		changelogLink.addEventListener("click", (evt) => {
			evt.preventDefault();
			openExternalUrl("https://github.com/2brn/epochgram/blob/main/CHANGELOG");
		});
	}
}
