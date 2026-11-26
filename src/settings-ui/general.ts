import type { Setting } from "obsidian";
import type { EpochPlugin } from "../main";
import { DEFAULT_SETTINGS } from "../settings-model";
import { normalizeFrontmatterPropertyKey } from "../plugin/frontmatter-keys";
import { registerInfoResetGesture } from "./info-reset-gesture";
import type { SettingRow } from "./setting-definitions";

type ToggleKey = "openEpochViewOnStartup" | "enableAnimation" | "anchorMdate" | "parseDatesInFrontmatter";
type SliderKey = "compactModeMinWidthPercent" | "searchResultsLimit" | "filenameWordsCount" | "summaryWordsCount";
type FrontmatterKey = "yamlDateProperty" | "yamlDescriptionProperty";

function toggleRow(plugin: EpochPlugin, key: ToggleKey, name: string, desc: string): SettingRow {
	return {
		name,
		desc,
		render(setting) {
			setting.addToggle((toggle) => {
				const save = async (value: boolean) => {
					if (plugin.settings[key] === value) return;
					plugin.settings[key] = value;
					await plugin.onSettingsChanged(key);
				};
				toggle.setValue(plugin.settings[key] === true).onChange(save);
				registerInfoResetGesture(setting, async () => {
					const value = DEFAULT_SETTINGS[key] === true;
					toggle.setValue(value);
					await save(value);
				});
			});
		}
	};
}

function sliderRow(
	plugin: EpochPlugin,
	key: SliderKey,
	name: string,
	desc: string,
	min: number,
	max: number,
	formatValue: (value: number) => string
): SettingRow {
	return {
		name,
		desc,
		render(setting) {
			const normalize = (value: number) => Number.isFinite(value)
				? Math.max(min, Math.min(max, Math.round(value)))
				: DEFAULT_SETTINGS[key];
			const setLabel = (value: number) => setting.setName(`${name} (${value === 0 ? "disabled" : formatValue(value)})`);
			const current = normalize(plugin.settings[key]);
			setLabel(current);
			setting.addSlider((slider) => {
				let resetting = false;
				const save = async (value: number) => {
					setLabel(value);
					if (plugin.settings[key] === value) return;
					plugin.settings[key] = value;
					await plugin.onSettingsChanged(key);
				};
				slider.setLimits(min, max, 1).setValue(current).onChange(async (value) => {
					if (resetting) return;
					const normalized = normalize(value);
					if (normalized !== value) {
						slider.setValue(normalized);
						return;
					}
					await save(normalized);
				});
				registerInfoResetGesture(setting, async () => {
					const value = DEFAULT_SETTINGS[key];
					resetting = true;
					slider.setValue(value);
					resetting = false;
					await save(value);
				});
			});
		}
	};
}

function frontmatterRow(
	plugin: EpochPlugin,
	key: FrontmatterKey,
	name: string,
	desc: string,
	onCommit?: () => void
): SettingRow {
	return {
		name,
		desc,
		render(setting) {
			const defaultValue = DEFAULT_SETTINGS[key];
			setting.addText((text) => {
				text.inputEl.classList.add("epoch-frontmatter-prop-input");
				text.setPlaceholder(defaultValue).setValue(plugin.settings[key] || defaultValue);
				const commit = async (value: string) => {
					if (text.getValue() !== value) text.setValue(value);
					const changed = plugin.settings[key] !== value;
					if (changed) plugin.settings[key] = value;
					onCommit?.();
					if (changed) await plugin.onSettingsChanged(key);
				};
				text.inputEl.addEventListener("blur", () => {
					void commit(normalizeFrontmatterPropertyKey(text.getValue(), defaultValue));
				});
				registerInfoResetGesture(setting, () => commit(defaultValue));
			});
		}
	};
}

export function defineGeneralViewSettings(plugin: EpochPlugin): SettingRow[] {
	return [
		toggleRow(plugin, "openEpochViewOnStartup", "Open on startup", "Automatically opens the timeline when Obsidian starts."),
		toggleRow(plugin, "enableAnimation", "Enable animation", "Turns on/off all animation."),
		sliderRow(plugin, "compactModeMinWidthPercent", "Record width limit", "Collapses overflow records into a (+n) group.", 0, 100, (value) => `${value}%`),
		sliderRow(plugin, "searchResultsLimit", "Search results count", "Limits search record suggestions count.", 1, 50, String)
	];
}

export function defineIndexerSettings(plugin: EpochPlugin): SettingRow[] {
	let anchorMdateSetting: Setting | undefined;
	const getAnchorMdateDesc = () => {
		const prop = plugin.settings.yamlDateProperty || DEFAULT_SETTINGS.yamlDateProperty;
		return `Uses mdate instead of cdate when no date is found in filename or YAML \`${prop}\`.`;
	};
	const anchorMdate = toggleRow(plugin, "anchorMdate", "Anchor mdate", "Uses mdate instead of cdate when no date is found in filename or the anchor property.");
	const words = (value: number) => `${value} words`;
	return [
		{
			...anchorMdate,
			render(setting) {
				anchorMdateSetting = setting;
				setting.setDesc(getAnchorMdateDesc());
				anchorMdate.render(setting);
				return () => {
					if (anchorMdateSetting === setting) anchorMdateSetting = undefined;
				};
			}
		},
		frontmatterRow(plugin, "yamlDateProperty", "Anchor property", "Uses as the note anchor date.", () => {
			anchorMdateSetting?.setDesc(getAnchorMdateDesc());
		}),
		frontmatterRow(plugin, "yamlDescriptionProperty", "Summary property", "Uses as the manual summary override."),
		toggleRow(plugin, "parseDatesInFrontmatter", "Parse all properties", "Scans all YAML properties for date values."),
		sliderRow(plugin, "filenameWordsCount", "Filename length", "Words of filename shown before summary (0 disables).", 0, 12, words),
		sliderRow(plugin, "summaryWordsCount", "Summary length", "Words per summary (0 disables).", 0, 12, words)
	];
}
