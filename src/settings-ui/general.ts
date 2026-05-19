import { Setting } from "obsidian";
import type { EpochPlugin } from "../main";
import { DEFAULT_SETTINGS } from "../settings-model";
import { registerInfoResetGesture } from "./info-reset-gesture";
import { normalizeFrontmatterPropertyKey } from "../plugin/frontmatter-keys";
import { hasTrackChangesAccess } from "../plugin/pro-feature-state";

export function renderGeneralViewSettings(containerEl: HTMLElement, plugin: EpochPlugin): void {
	let openOnStartupToggle: any = null;
	const openOnStartupSetting = new Setting(containerEl)
			.setName("Open on startup")
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

	const compactModeMinWidthSetting = new Setting(containerEl);
	const setCompactModeMinWidthLabel = (val: number) => {
		if (val <= 0) {
			compactModeMinWidthSetting.setName("Record width limit (disabled)");
		} else {
			compactModeMinWidthSetting.setName(`Record width limit (${val}%)`);
		}
	};
	const currentCompactModeMinWidth = Number.isFinite(Number(plugin.settings.compactModeMinWidthPercent))
		? Math.max(0, Math.min(100, Math.round(Number(plugin.settings.compactModeMinWidthPercent))))
		: Math.max(0, Math.min(100, Math.round(Number(DEFAULT_SETTINGS.compactModeMinWidthPercent))));
	setCompactModeMinWidthLabel(currentCompactModeMinWidth);
	compactModeMinWidthSetting.setDesc("Collapse overflow records into a (+n) group.");
	let compactModeMinWidthSlider: any = null;
	let suppressCompactModeMinWidthOnChange = false;
	compactModeMinWidthSetting.addSlider((slider) => {
		compactModeMinWidthSlider = slider;
		slider
			.setLimits(0, 100, 1)
			.setValue(currentCompactModeMinWidth)
			.setDynamicTooltip()
			.onChange(async (value) => {
				if (suppressCompactModeMinWidthOnChange) return;
				const rounded = Math.max(0, Math.min(100, Math.round(value)));
				if (rounded !== value) {
					slider.setValue(rounded);
					return;
				}
				if (plugin.settings.compactModeMinWidthPercent === rounded) return;
				plugin.settings.compactModeMinWidthPercent = rounded;
				setCompactModeMinWidthLabel(rounded);
				await plugin.onSettingsChanged("compactModeMinWidthPercent");
			});
	});
	registerInfoResetGesture(compactModeMinWidthSetting, async () => {
		const def = Math.max(0, Math.min(100, Math.round(Number(DEFAULT_SETTINGS.compactModeMinWidthPercent))));
		if (!compactModeMinWidthSlider) return;
		if (plugin.settings.compactModeMinWidthPercent === def) {
			setCompactModeMinWidthLabel(def);
			return;
		}
		suppressCompactModeMinWidthOnChange = true;
		compactModeMinWidthSlider.setValue(def);
		suppressCompactModeMinWidthOnChange = false;
		plugin.settings.compactModeMinWidthPercent = def;
		setCompactModeMinWidthLabel(def);
		await plugin.onSettingsChanged("compactModeMinWidthPercent");
	});
}

export function renderIndexerSettings(containerEl: HTMLElement, plugin: EpochPlugin): void {
	const canTrackChanges = hasTrackChangesAccess(plugin);
	let trackChangesToggle: any = null;
	const trackChangesSetting = new Setting(containerEl)
		.setName("Track changes")
		.setDesc(canTrackChanges ? "Track note change history on the timeline." : "Requires Epochgram Pro.")
		.addToggle((toggle: any) => {
			trackChangesToggle = toggle;
			toggle
				.setValue(canTrackChanges ? plugin.settings.trackChanges === true : false)
				.setDisabled(!canTrackChanges)
				.onChange(async (value: boolean) => {
					if (!canTrackChanges) return;
					plugin.settings.trackChanges = value;
					await plugin.onSettingsChanged("trackChanges");
				});
		});
	if (!canTrackChanges) {
		trackChangesSetting.settingEl?.classList?.add("epoch-pro-locked-row");
	}
	registerInfoResetGesture(trackChangesSetting, async () => {
		const def = DEFAULT_SETTINGS.trackChanges === true;
		if (trackChangesToggle) trackChangesToggle.setValue(canTrackChanges ? def : false);
		if (!canTrackChanges) return;
		plugin.settings.trackChanges = def;
		await plugin.onSettingsChanged("trackChanges");
	});

	const getAnchorMdateDesc = () => {
		const prop = plugin.settings.yamlDateProperty || DEFAULT_SETTINGS.yamlDateProperty;
		return `Use mdate instead of cdate when no date is found in filename or YAML \`${prop}\`.`;
	};
	let anchorMdateToggle: any = null;
	const anchorMdateSetting = new Setting(containerEl)
		.setName("Anchor by mdate")
		.setDesc(getAnchorMdateDesc())
		.addToggle((toggle: any) => {
			anchorMdateToggle = toggle;
			toggle
				.setValue(plugin.settings.anchorMdate === true)
				.onChange(async (value: boolean) => {
					plugin.settings.anchorMdate = value;
					await plugin.onSettingsChanged("anchorMdate");
				});
		});
	registerInfoResetGesture(anchorMdateSetting, async () => {
		const def = DEFAULT_SETTINGS.anchorMdate === true;
		if (anchorMdateToggle) anchorMdateToggle.setValue(def);
		plugin.settings.anchorMdate = def;
		await plugin.onSettingsChanged("anchorMdate");
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
		anchorMdateSetting.setDesc(getAnchorMdateDesc());
		await plugin.onSettingsChanged("yamlDateProperty");
	};
	const yamlDatePropSetting = new Setting(containerEl)
		.setName("Anchor property")
		.setDesc("Used as the note anchor date.")
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
		anchorMdateSetting.setDesc(getAnchorMdateDesc());
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
		.setName("Summary property")
		.setDesc("Used as manual summary override.")
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

	let parseDatesInFrontmatterToggle: any = null;
	const parseDatesInFrontmatterSetting = new Setting(containerEl)
		.setName("Parse all properties")
		.setDesc("Scan all YAML properties for date values.")
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
