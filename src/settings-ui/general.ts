import { Setting } from "obsidian";
import type { EpochPlugin } from "../main";
import { DEFAULT_SETTINGS } from "../settings-model";
import { registerInfoResetGesture } from "./info-reset-gesture";
import { normalizeFrontmatterPropertyKey } from "../plugin/frontmatter-keys";

export function renderGeneralSettings(containerEl: HTMLElement, plugin: EpochPlugin): void {
	let openOnStartupToggle: any = null;
	const openOnStartupSetting = new Setting(containerEl)
			.setName("Open timeline on startup")
			.setDesc("Automatically opens the timeline when Obsidian starts.")
		.addToggle((toggle: any) => {
			openOnStartupToggle = toggle;
			toggle
				.setValue(plugin.settings.openEpochViewOnStartup)
				.onChange(async (value: boolean) => {
					plugin.settings.openEpochViewOnStartup = value;
					await plugin.onSettingsChanged("openEpochViewOnStartup");
				});
		});
	registerInfoResetGesture(openOnStartupSetting, async () => {
		const def = DEFAULT_SETTINGS.openEpochViewOnStartup;
		if (openOnStartupToggle) openOnStartupToggle.setValue(def);
		plugin.settings.openEpochViewOnStartup = def;
		await plugin.onSettingsChanged("openEpochViewOnStartup");
	});

	let enableAnimationToggle: any = null;
	const enableAnimationSetting = new Setting(containerEl)
		.setName("Enable animation")
		.setDesc("Turns on/off all animation.")
		.addToggle((toggle: any) => {
			enableAnimationToggle = toggle;
			toggle
				.setValue(plugin.settings.enableAnimation)
				.onChange(async (value: boolean) => {
					plugin.settings.enableAnimation = value;
					await plugin.onSettingsChanged("enableAnimation");
				});
		});
	registerInfoResetGesture(enableAnimationSetting, async () => {
		const def = DEFAULT_SETTINGS.enableAnimation;
		if (enableAnimationToggle) enableAnimationToggle.setValue(def);
		plugin.settings.enableAnimation = def;
		await plugin.onSettingsChanged("enableAnimation");
	});

	let parseDatesInFrontmatterToggle: any = null;
	const parseDatesInFrontmatterSetting = new Setting(containerEl)
		.setName("Parse dates in properties")
		.setDesc("Includes YAML frontmatter dates.")
		.addToggle((toggle: any) => {
			parseDatesInFrontmatterToggle = toggle;
			toggle
				.setValue(plugin.settings.parseDatesInFrontmatter === true)
				.onChange(async (value: boolean) => {
					plugin.settings.parseDatesInFrontmatter = value;
					await plugin.onSettingsChanged("parseDatesInFrontmatter");
				});
		});
	registerInfoResetGesture(parseDatesInFrontmatterSetting, async () => {
		const def = DEFAULT_SETTINGS.parseDatesInFrontmatter === true;
		if (parseDatesInFrontmatterToggle) parseDatesInFrontmatterToggle.setValue(def);
		plugin.settings.parseDatesInFrontmatter = def;
		await plugin.onSettingsChanged("parseDatesInFrontmatter");
	});

	let yamlDatePropText: any = null;
	let yamlDatePropPending = String(plugin.settings.yamlDateProperty || DEFAULT_SETTINGS.yamlDateProperty);
	const commitYamlDateProperty = async (): Promise<void> => {
		const normalized = normalizeFrontmatterPropertyKey(yamlDatePropPending, DEFAULT_SETTINGS.yamlDateProperty);
		if (yamlDatePropText && yamlDatePropText.getValue() !== normalized) {
			yamlDatePropText.setValue(normalized);
		}
		yamlDatePropPending = normalized;
		if (plugin.settings.yamlDateProperty === normalized) return;
		plugin.settings.yamlDateProperty = normalized;
		await plugin.onSettingsChanged("yamlDateProperty");
	};
	const yamlDatePropSetting = new Setting(containerEl)
		.setName("Date property name")
		.setDesc("YAML property used as the anchor date.")
		.addText((text: any) => {
			yamlDatePropText = text;
			text.inputEl?.classList.add("epoch-frontmatter-prop-input");
			text
				.setPlaceholder(DEFAULT_SETTINGS.yamlDateProperty)
				.setValue(yamlDatePropPending)
				.onChange((value: string) => {
					yamlDatePropPending = value;
				});
			text.inputEl?.addEventListener("blur", () => {
				void commitYamlDateProperty();
			});
		});
	registerInfoResetGesture(yamlDatePropSetting, async () => {
		const def = DEFAULT_SETTINGS.yamlDateProperty;
		if (yamlDatePropText) yamlDatePropText.setValue(def);
		yamlDatePropPending = def;
		plugin.settings.yamlDateProperty = def;
		await plugin.onSettingsChanged("yamlDateProperty");
	});

	let yamlDescriptionPropText: any = null;
	let yamlDescriptionPropPending = String(plugin.settings.yamlDescriptionProperty || DEFAULT_SETTINGS.yamlDescriptionProperty);
	const commitYamlDescriptionProperty = async (): Promise<void> => {
		const normalized = normalizeFrontmatterPropertyKey(yamlDescriptionPropPending, DEFAULT_SETTINGS.yamlDescriptionProperty);
		if (yamlDescriptionPropText && yamlDescriptionPropText.getValue() !== normalized) {
			yamlDescriptionPropText.setValue(normalized);
		}
		yamlDescriptionPropPending = normalized;
		if (plugin.settings.yamlDescriptionProperty === normalized) return;
		plugin.settings.yamlDescriptionProperty = normalized;
		await plugin.onSettingsChanged("yamlDescriptionProperty");
	};
	const yamlDescriptionPropSetting = new Setting(containerEl)
		.setName("Description property name")
		.setDesc("YAML property used as summary override.")
		.addText((text: any) => {
			yamlDescriptionPropText = text;
			text.inputEl?.classList.add("epoch-frontmatter-prop-input");
			text
				.setPlaceholder(DEFAULT_SETTINGS.yamlDescriptionProperty)
				.setValue(yamlDescriptionPropPending)
				.onChange((value: string) => {
					yamlDescriptionPropPending = value;
				});
			text.inputEl?.addEventListener("blur", () => {
				void commitYamlDescriptionProperty();
			});
		});
	registerInfoResetGesture(yamlDescriptionPropSetting, async () => {
		const def = DEFAULT_SETTINGS.yamlDescriptionProperty;
		if (yamlDescriptionPropText) yamlDescriptionPropText.setValue(def);
		yamlDescriptionPropPending = def;
		plugin.settings.yamlDescriptionProperty = def;
		await plugin.onSettingsChanged("yamlDescriptionProperty");
	});

	const filenameSetting = new Setting(containerEl);
	const setFilenameLabel = (val: number) => {
		if (val <= 0) {
			filenameSetting.setName("Filename length (disabled)");
		} else {
			filenameSetting.setName(`Filename length (${val} words)`);
		}
	};
	const currentFilenameWords = plugin.settings.filenameWordsCount;
	setFilenameLabel(currentFilenameWords);
	filenameSetting.setDesc("Words of filename shown before summary (0 disables).");
	let filenameSlider: any = null;
	let suppressFilenameSliderOnChange = false;
	filenameSetting.addSlider((slider) => {
		filenameSlider = slider;
		slider
			.setLimits(0, 12, 1)
			.setValue(currentFilenameWords)
			.setDynamicTooltip()
			.onChange(async (value) => {
				if (suppressFilenameSliderOnChange) return;
				const rounded = Math.round(value);
				if (rounded !== value) {
					slider.setValue(rounded);
					return;
				}
				if (plugin.settings.filenameWordsCount === rounded) return;
				plugin.settings.filenameWordsCount = rounded;
				setFilenameLabel(rounded);
				await plugin.onSettingsChanged("filenameWordsCount");
			});
	});

	registerInfoResetGesture(filenameSetting, async () => {
		const def = DEFAULT_SETTINGS.filenameWordsCount;
		if (!filenameSlider) return;
		if (plugin.settings.filenameWordsCount === def) {
			setFilenameLabel(def);
			return;
		}
		suppressFilenameSliderOnChange = true;
		filenameSlider.setValue(def);
		suppressFilenameSliderOnChange = false;
		plugin.settings.filenameWordsCount = def;
		setFilenameLabel(def);
		await plugin.onSettingsChanged("filenameWordsCount");
	});

	const summarySetting = new Setting(containerEl);
	const setSummaryLabel = (val: number) => {
		if (val <= 0) {
			summarySetting.setName("Summary length (disabled)");
		} else {
			summarySetting.setName(`Summary length (${val} words)`);
		}
	};
	const currentSummaryWords = plugin.settings.summaryWordsCount;
	setSummaryLabel(currentSummaryWords);
	summarySetting.setDesc("Words per summary (0 disables). ");
	let summarySlider: any = null;
	let suppressSummarySliderOnChange = false;
	summarySetting.addSlider((slider) => {
		summarySlider = slider;
		slider
			.setLimits(0, 12, 1)
			.setValue(currentSummaryWords)
			.setDynamicTooltip()
			.onChange(async (value) => {
				if (suppressSummarySliderOnChange) return;
				const rounded = Math.round(value);
				if (rounded !== value) {
					slider.setValue(rounded);
					return;
				}
				if (plugin.settings.summaryWordsCount === rounded) return;
				plugin.settings.summaryWordsCount = rounded;
				setSummaryLabel(rounded);
				await plugin.onSettingsChanged("summaryWordsCount");
			});
	});

	registerInfoResetGesture(summarySetting, async () => {
		const def = DEFAULT_SETTINGS.summaryWordsCount;
		if (!summarySlider) return;
		if (plugin.settings.summaryWordsCount === def) {
			setSummaryLabel(def);
			return;
		}
		suppressSummarySliderOnChange = true;
		summarySlider.setValue(def);
		suppressSummarySliderOnChange = false;
		plugin.settings.summaryWordsCount = def;
		setSummaryLabel(def);
		await plugin.onSettingsChanged("summaryWordsCount");
	});
}
