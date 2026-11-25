import { Setting, type App, type DropdownComponent, type SliderComponent } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings-model";
import { registerInfoResetGesture } from "./info-reset-gesture";
import type { EpochPlugin } from "../main";
import { createSettingGroup } from "./setting-groups";
import { getEffectiveTitleSimilarityThreshold } from "../plugin/similarity/config";
import { resolveSecretPlaceholders } from "../utils/secret-placeholders";
import { FolderPathSuggest, FilePathSuggest } from "../ui/modals/path-suggest";

export function renderAdvancedSettings(container: HTMLElement, app: App, plugin: EpochPlugin, refresh: () => void): void {
	const refreshWithoutScroll = () => {
		const scrollable = container.closest(".vertical-tab-content") ?? container.closest(".settings") ?? container;
		const top = scrollable.scrollTop; refresh(); scrollable.scrollTop = top;
	};
	const similarity = createSettingGroup(container, "Similarity").itemsEl;
	const calendar = createSettingGroup(container, "Calendar sync").itemsEl;
	new Setting(similarity).setName("Use links").setDesc("Includes links and backlinks.").addToggle(toggle => toggle.setValue(plugin.settings.similarityUseLinks !== false).onChange(async value => { plugin.settings.similarityUseLinks = value; await plugin.onSettingsChanged("similarityUseLinks"); }));
	new Setting(similarity).setName("Use tags").setDesc("Includes shared tags.").addToggle(toggle => toggle.setValue(plugin.settings.similarityUseTags !== false).onChange(async value => { plugin.settings.similarityUseTags = value; await plugin.onSettingsChanged("similarityUseTags"); }));
	const title = new Setting(similarity).setDesc("Includes similar filenames (0 disables, 1.0 = same folder).");
	const label = (value: number) => title.setName(`Title threshold (${value === 0 ? "disabled" : value === 1 ? "same folder" : value.toFixed(2)})`);
	label(getEffectiveTitleSimilarityThreshold(plugin));
	let titleSlider: SliderComponent;
	title.addSlider(slider => {
		titleSlider = slider;
		slider.setLimits(0, 1, 0.01).setValue(getEffectiveTitleSimilarityThreshold(plugin)).onChange(async value => {
			plugin.settings.similarityTitleJwThreshold = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : DEFAULT_SETTINGS.similarityTitleJwThreshold;
			const normalized = getEffectiveTitleSimilarityThreshold(plugin);
			if (normalized !== value) slider.setValue(normalized);
			label(normalized); await plugin.onSettingsChanged("similarityTitleJwThreshold");
		});
	});
	registerInfoResetGesture(title, async () => {
		const value = Number(DEFAULT_SETTINGS.similarityTitleJwThreshold);
		titleSlider?.setValue(value); label(value);
		if (plugin.settings.similarityTitleJwThreshold === value) return;
		plugin.settings.similarityTitleJwThreshold = value; await plugin.onSettingsChanged("similarityTitleJwThreshold");
	});
	const urls = plugin.settings.calendarSyncIcsUrls ?? [];
	const links = new Setting(calendar).setName("ICS link").setDesc("Calendar feed links; secret placeholders are supported.");
	links.settingEl.classList.add("epoch-calendar-links-setting");
	links.descEl.createEl("a", { text: " Read docs", href: "https://www.epochgram.com/docs#calendar-sync", attr: { target: "_blank", rel: "noopener noreferrer" } });
	const validUrl = (value: string) => {
		try {
			const resolved = resolveSecretPlaceholders(value, id => app.secretStorage.getSecret(id));
			return ["http:", "https:"].includes(new URL(resolved.replace(/^webcal:/i, "https:")).protocol);
		} catch { return false; }
	};
	[...urls, ""].forEach((url, index) => { links.addText(text => {
		text.setPlaceholder("https://example.com/calendar.ics").setValue(url);
		text.inputEl.classList.add("epoch-calendar-link-input");
		text.onChange(value => text.inputEl.classList.toggle("epoch-invalid-url-input", !!value.trim() && !validUrl(value.trim())));
		text.inputEl.addEventListener("blur", () => {
			void (async () => {
				const value = text.getValue().trim();
				if (value && !validUrl(value)) return;
				const next = [...urls]; next[index] = value;
				const cleaned = [...new Set(next.filter(Boolean))];
				if (JSON.stringify(cleaned) === JSON.stringify(urls)) return;
				plugin.settings.calendarSyncIcsUrls = cleaned; await plugin.onSettingsChanged("calendarSyncIcsUrls"); refreshWithoutScroll();
			})();
		});
	}); });
	const periods = { manual: "Manual", startup: "On startup", "1m": "Every 1 min", "5m": "Every 5 min", "15m": "Every 15 min", "1h": "Every 1 hour", "6h": "Every 6 hours", "24h": "Every 24 hours" };
	const normalizePeriod = (value: unknown): keyof typeof periods => typeof value === "string" && Object.prototype.hasOwnProperty.call(periods, value) ? value as keyof typeof periods : "manual";
	let periodDropdown: DropdownComponent;
	const period = new Setting(calendar).setName("Sync period").setDesc("Manual, startup, or fixed interval sync.").addDropdown(dropdown => {
		periodDropdown = dropdown;
		for (const [value, label] of Object.entries(periods)) dropdown.addOption(value, label);
		dropdown.setValue(normalizePeriod(plugin.settings.calendarSyncPeriod)).onChange(async value => { plugin.settings.calendarSyncPeriod = normalizePeriod(value); await plugin.onSettingsChanged("calendarSyncPeriod"); });
	});
	registerInfoResetGesture(period, async () => {
		const value = normalizePeriod(DEFAULT_SETTINGS.calendarSyncPeriod);
		periodDropdown?.setValue(value);
		if (plugin.settings.calendarSyncPeriod === value) return;
		plugin.settings.calendarSyncPeriod = value; await plugin.onSettingsChanged("calendarSyncPeriod");
	});
	new Setting(calendar).setName("Event file location").setDesc("Default uses daily notes folder.").addText(text => {
		new FolderPathSuggest(app, text.inputEl);
		text.setValue(plugin.settings.calendarSyncFolder ?? "").setPlaceholder(plugin.getDailyNoteFolder() || "/");
		text.inputEl.addEventListener("blur", () => { plugin.settings.calendarSyncFolder = text.getValue().trim().replace(/\\/g, "/").replace(/^\/+/, ""); void plugin.onSettingsChanged("calendarSyncFolder"); });
	});
	new Setting(calendar).setName("Template file location").setDesc("Template file path for the event note.").addText(text => {
		new FilePathSuggest(app, text.inputEl);
		text.setValue(plugin.settings.calendarSyncTemplatePath ?? "");
		text.inputEl.addEventListener("blur", () => { plugin.settings.calendarSyncTemplatePath = text.getValue().trim().replace(/\\/g, "/").replace(/^\/+/, ""); void plugin.onSettingsChanged("calendarSyncTemplatePath"); });
	});
}
