import { AbstractInputSuggest, Notice, Platform, Setting, TFile, TFolder, setIcon, type App, type DropdownComponent, type SliderComponent, type TextComponent } from "obsidian";
import { formatDate } from "utils";
import type { EpochPlugin } from "../main";
import { NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "../utils";
import {
	RESET_PRO_SIMILARITY_THRESHOLD,
	RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE
} from "../settings-reset-defaults";
import { confirmModal, SimilarityModelSuggestModal } from "../ui/modals";
import { DEFAULT_SETTINGS } from "../settings-model";
import { registerInfoResetGesture } from "./info-reset-gesture";
import { countMissingAiSummaries, hasMissingAiSummariesFast } from "../plugin/ai-summaries/file-jobs";
import { countMissingEpochsFast } from "../plugin/ai-summaries/epochs";
import { ensureAiBridgeServerRunning } from "../plugin/ai-summaries/bridge-server";
import { resolveSecretPlaceholders } from "../utils/secret-placeholders";
import { createSettingGroup } from "./setting-groups";
import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL, NO_SIMILARITY_MODEL } from "../plugin/similarity/config";
import {
	hasAiBridgeAccess,
	hasGenerateEpochsAccess,
	hasSimilarityAccess,
	hasSummarizeAIAccess,
	hasVerifiedEntitlement
} from "../plugin/pro-feature-state";

const activeDocument = (typeof window !== "undefined" ? window.document : ({} as Document));

type ProPanelOptions = {
	advancedGroupsParentEl?: HTMLElement;
};

type ElectronShellApi = { openExternal?: (url: string) => unknown };
type ElectronApi = { shell?: ElectronShellApi };
type WindowWithRequire = Window & { require?: (moduleName: string) => unknown };
type ProPanelRuntime = {
	ensureIndexLoaded?: () => Promise<void>;
	generateMissingAiSummariesForAllRecords?: () => Promise<void>;
	regenerateMissingEpochsForAllRecords?: () => Promise<void>;
};

type InternalPluginLike = {
	enabled?: boolean;
	instance?: {
		options?: Record<string, unknown>;
		data?: Record<string, unknown>;
		getData?: () => unknown;
	};
};

type InternalPluginsLike = {
	getPluginById?: (id: string) => InternalPluginLike | null;
	plugins?: Record<string, InternalPluginLike>;
};

type VaultConfigLike = {
	getConfig?: (key: string) => unknown;
};

const InputSuggestBase = (AbstractInputSuggest ?? class {
	constructor(_app: App, _inputEl: HTMLInputElement) {
	}

	close(): void {
	}
});

class FolderPathSuggest extends InputSuggestBase<TFolder> {
	private readonly appRef: App;
	private readonly inputRef: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.appRef = app;
		this.inputRef = inputEl;
	}

	getSuggestions(inputStr: string): TFolder[] {
		const query = inputStr.trim().toLowerCase();
		const folders = this.appRef.vault
			.getAllLoadedFiles()
			.filter((item): item is TFolder => item instanceof TFolder)
			.sort((a, b) => a.path.localeCompare(b.path));
		if (!query) return folders;
		return folders.filter((folder) => folder.path.toLowerCase().includes(query));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || "/");
	}

	selectSuggestion(folder: TFolder): void {
		this.inputRef.value = folder.path || "";
		this.inputRef.dispatchEvent(new Event("input"));
		this.close();
	}
}

class FilePathSuggest extends InputSuggestBase<TFile> {
	private readonly appRef: App;
	private readonly inputRef: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.appRef = app;
		this.inputRef = inputEl;
	}

	getSuggestions(inputStr: string): TFile[] {
		const query = inputStr.trim().toLowerCase();
		const files = this.appRef.vault
			.getMarkdownFiles()
			.sort((a, b) => a.path.localeCompare(b.path));
		if (!query) return files;
		return files.filter((file) => file.path.toLowerCase().includes(query));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.inputRef.value = file.path;
		this.inputRef.dispatchEvent(new Event("input"));
		this.close();
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function readBoolFromRecords(records: Array<Record<string, unknown> | null>, keys: string[]): boolean | null {
	for (const rec of records) {
		if (!rec) continue;
		for (const key of keys) {
			if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
			const raw = rec[key];
			if (typeof raw === "boolean") return raw;
		}
	}
	return null;
}

function getWebViewerRequirements(app: App): { enabled: boolean; openExternalLinks: boolean } {
	try {
		const internal = (app as unknown as { internalPlugins?: InternalPluginsLike }).internalPlugins;
		const plugin = typeof internal?.getPluginById === "function"
			? internal.getPluginById("webviewer")
			: (internal?.plugins?.["webviewer"] ?? null);
		const enabled = plugin?.enabled === true;
		const instanceData = (() => {
			try {
				return plugin?.instance?.getData?.();
			} catch {
				return null;
			}
		})();
		const vaultWebViewerCfg = (() => {
			try {
				const vault = app.vault as unknown as VaultConfigLike;
				return vault?.getConfig?.("webviewer");
			} catch {
				return null;
			}
		})();
		const records = [
			asRecord(plugin?.instance?.options),
			asRecord(plugin?.instance?.data),
			asRecord(instanceData),
			asRecord(vaultWebViewerCfg)
		];
		const openExternalLinks = readBoolFromRecords(records, [
			"openExternalLinks",
			"openExternalURLs",
			"openLinksExternally",
			"openExternal"
		]);
		return {
			enabled,
			openExternalLinks: openExternalLinks === true
		};
	} catch {
		return { enabled: false, openExternalLinks: false };
	}
}

export function renderProPanel(
	containerEl: HTMLElement,
	app: App,
	plugin: EpochPlugin,
	refresh: () => void,
	options?: ProPanelOptions
): void {
	// Clear pending license key when settings panel is opened/refreshed
	plugin.proActivationPendingKey = "";

	const openExternalUrl = (url: string): void => {
		try {
			const requireFn = (window as WindowWithRequire).require;
			if (typeof requireFn === "function") {
				const loaded = requireFn("electron");
				const electron = (typeof loaded === "object" && loaded !== null) ? (loaded as ElectronApi) : null;
				const openExternal = electron?.shell?.openExternal;
				if (typeof openExternal === "function") {
					void openExternal(url);
					return;
				}
			}
				return;
		} catch {
			// ignore
		}
		try {
			window.open(url);
		} catch {
			// ignore
		}
	};

	const openEmbeddedUrl = async (url: string): Promise<void> => {
		openExternalUrl(url);
	};
	const PRO_URL = "https://www.epochgram.com/pro";
	const HF_SEMANTICS_SEARCH_URL = "https://huggingface.co/models?pipeline_tag=feature-extraction&library=transformers.js&search=xenova&sort=downloads";
	const HF_TOPICS_SEARCH_URL = "https://huggingface.co/models?pipeline_tag=zero-shot-classification&library=transformers.js&search=xenova&sort=downloads";

	const refreshWithoutScroll = (): void => {
		const scrollableParent = containerEl.closest(".vertical-tab-content") || containerEl.closest(".settings") || containerEl;
		const scrollTop = scrollableParent.scrollTop;
		refresh();
		scrollableParent.scrollTop = scrollTop;
	};

	const isPro = hasVerifiedEntitlement(plugin);
	const canSimilarity = hasSimilarityAccess(plugin);
	const canSummarize = hasSummarizeAIAccess(plugin);
	const canGenerateEpochs = hasGenerateEpochsAccess(plugin);
	const canAiBridge = hasAiBridgeAccess(plugin);
	const claimKeyPreview = String(plugin.settings.claimKeyPreview ?? "").trim();
	const activationStatus = String(plugin.settings.activationStatus ?? (isPro ? "active" : "inactive")).trim();
	const lastValidationAt = String(plugin.settings.lastValidationAt ?? "").trim();
	const activationBusy = plugin.proActivationBusy === true;
	let pendingKey = String(plugin.proActivationPendingKey ?? "").trim();

	const { groupEl: proGroupEl, itemsEl: proItems } = createSettingGroup(containerEl);
	proGroupEl.classList.add("epoch-pro-settings-group");
	const advancedGroupsParentEl = options?.advancedGroupsParentEl ?? containerEl;

	const formatValidationTime = (value: string): string => {
		if (!value) return "";
		const ms = Date.parse(value);
		if (!Number.isFinite(ms)) return "";
		return new Date(ms).toLocaleString();
	};

	const statusText = (() => {
		const base = (() => {
			if (isPro) return "Pro: Active";
			if (activationStatus === "validating") return "Pro: Verifying license";
			if (activationStatus === "device-limit") return "Pro: Device limit reached";
			if (activationStatus === "revoked") return "Pro: Reactivation required";
			if (activationStatus === "invalid" || activationStatus === "invalid-claim") return "Pro: License key not found";
			if (activationStatus === "error") return "Pro: Verification unavailable";
			return "Pro: Inactive";
		})();
		const shouldShowLastCheck = isPro || activationStatus === "validating" || activationStatus === "error";
		const formattedCheck = formatValidationTime(lastValidationAt);
		return shouldShowLastCheck && formattedCheck ? `${base} | Last check ${formattedCheck}` : base;
	})();
	const statusClass = (() => {
		if (isPro) return "mod-success";
		if (activationStatus === "error") return "mod-warning";
		if (activationStatus === "inactive") return "mod-warning";
		return "mod-warning";
	})();
	const appendStatusDescription = (parentEl: HTMLElement): void => {
		const statusWrapper = parentEl.createSpan({ cls: `epoch-license-status ${statusClass}` });
		statusWrapper.createEl("strong", { text: statusText });
	};
	const licensePlaceholder = "EPO-XXXX-XXXX-XXXX-XXXX-XXXX";
	const visibleLicenseValue = pendingKey || claimKeyPreview;
	const triggerActivation = async () => {
		const key = pendingKey.trim();
		if (!key) {
			refreshWithoutScroll();
			return;
		}
		if (isPro) {
			const ok = await confirmModal(app, {
				title: "Reactivate Epochgram Pro?",
				description: "Epochgram Pro is already active. Reactivating will replace the license.",
				yesText: "Reactivate",
				noText: "Cancel"
			});
			if (!ok) {
				refreshWithoutScroll();
				return;
			}
		}
		plugin.proActivationPendingKey = key;
		plugin.proActivationBusy = true;
		refreshWithoutScroll();
		try {
			const { valid, message } = await plugin.applyClaimKey(key);
			if (message) new Notice(message, valid ? 4000 : 10000);
			if (valid) {
				pendingKey = "";
				plugin.proActivationPendingKey = "";
			}
		} finally {
			plugin.proActivationBusy = false;
			plugin.proActivationPendingKey = "";
			refreshWithoutScroll();
		}
	};
	const markLockedRow = <T extends Setting>(setting: T): T => {
		if (!isPro) setting.settingEl?.classList?.add("epoch-pro-locked-row");
		return setting;
	};
	const markLockedHeading = (groupEl: HTMLElement): void => {
		if (isPro) return;
		const headingEl = groupEl.querySelector(":scope > .setting-item-heading");
		headingEl?.classList?.add("epoch-pro-locked-row");
	};
	const renderLicenseSetting = (parentEl: HTMLElement): Setting => {
		const licenseSetting = new Setting(parentEl).setName("License key").setDesc("");
		licenseSetting.descEl.empty();
		appendStatusDescription(licenseSetting.descEl);
		let licenseLayoutFrame = 0;
		const updateLicenseLayout = (): void => {
			if (!licenseSetting.settingEl?.isConnected) return;
			const hostEl = licenseSetting.settingEl;
			const infoEl = hostEl.querySelector(":scope > .setting-item-info");
			const controlEl = hostEl.querySelector(":scope > .setting-item-control");
			if (!infoEl || !controlEl) return;
			const hostWidth = Math.max(0, hostEl.clientWidth);
			const infoWidth = Math.ceil(infoEl.getBoundingClientRect().width);
			const controlWidth = Math.ceil(controlEl.scrollWidth);
			const needsStack = hostWidth > 0 && infoWidth + controlWidth + 24 > hostWidth;
			hostEl.classList.toggle("epoch-license-auto-stack", needsStack);
		};
		const scheduleLicenseLayout = (): void => {
			if (licenseLayoutFrame) window.cancelAnimationFrame(licenseLayoutFrame);
			licenseLayoutFrame = window.requestAnimationFrame(() => {
				licenseLayoutFrame = 0;
				updateLicenseLayout();
			});
		};
		licenseSetting.settingEl?.classList?.add("epoch-license-setting");
		const hasStoredClaimKeyPreview = claimKeyPreview.trim().length > 0;
		if (hasStoredClaimKeyPreview) {
			licenseSetting.settingEl?.classList?.add("epoch-license-active-preview");
		}
		const isMobile = Platform.isMobile || Platform.isMobile;
		if (isMobile) {
			try {
				licenseSetting.settingEl?.classList?.add("epoch-license-mobile-stack");
			} catch {
				// ignore
			}
		}
		if (typeof ResizeObserver !== "undefined") {
			try {
				const observer = new ResizeObserver(() => {
					scheduleLicenseLayout();
					if (!licenseSetting.settingEl?.isConnected) observer.disconnect();
				});
				observer.observe(licenseSetting.settingEl);
			} catch {
				// ignore
			}
		}
		licenseSetting.addText((text) => {
			text
				.setPlaceholder(licensePlaceholder)
				.setValue(visibleLicenseValue)
				.setDisabled(activationBusy)
				.onChange((value) => {
					pendingKey = value;
					plugin.proActivationPendingKey = value;
				});
			text.inputEl.type = "text";
			if (isPro) {
				window.requestAnimationFrame(() => {
					try {
						if (activeDocument.activeElement === text.inputEl) {
							text.inputEl.blur();
						}
					} catch {
						// ignore
					}
				});
			}
			text.inputEl.addEventListener("focus", () => {
				if (!claimKeyPreview) return;
				if (pendingKey.trim().length > 0) return;
				if (text.inputEl.value.trim() !== claimKeyPreview) return;
				text.inputEl.value = "";
			});
			text.inputEl.addEventListener("blur", () => {
				const typed = text.inputEl.value.trim();
				pendingKey = typed;
				plugin.proActivationPendingKey = typed;
				if (typed.length > 0) return;
				if (!claimKeyPreview) return;
				text.inputEl.value = claimKeyPreview;
			});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
					event.preventDefault();
					void triggerActivation();
				}
			});
			scheduleLicenseLayout();
		});
		licenseSetting.addButton((button) => {
			button.setButtonText(hasStoredClaimKeyPreview ? "Reactivate" : "Activate");
			if (activationBusy) {
				button.buttonEl.classList.add('mod-loading');
			} else {
				button.buttonEl.classList.remove('mod-loading');
			}
			if (!hasStoredClaimKeyPreview && !activationBusy) button.setCta();
			button.setDisabled(activationBusy);
			button.onClick(async () => {
				await triggerActivation();
			});
			scheduleLicenseLayout();
		});
		scheduleLicenseLayout();
		return licenseSetting;
	};

	if (!isPro) {
		const upsellItems = [
			"Summarize records via AI bridge (on-device or cloud)",
			"Generate multi-day Epochs for broader time retrospectives",
			"Find similar records across links, tags, semantics, and topics",
			"Track edits, sync calendars, and create recurring events"
		];
		const upsellSetting = new Setting(proItems)
			.setName("Unlock the full Epochgram Pro experience")
			.setDesc("");
		upsellSetting.descEl.empty();
		const upsellList = upsellSetting.descEl.createEl("ul");
		for (const item of upsellItems) {
			upsellList.createEl("li", { text: item });
		}
		upsellSetting.settingEl?.classList?.add("epoch-pro-upsell-row");
		upsellSetting.addButton((button) => {
			button
				.setCta()
				.onClick(() => {
					openExternalUrl(PRO_URL);
				});
			const buttonEl = button.buttonEl;
			buttonEl?.classList?.remove("mod-icon");
			buttonEl?.classList?.add("epoch-pro-get-pro-button");
			window.requestAnimationFrame(() => {
				try {
					if (activeDocument.activeElement === buttonEl) {
						buttonEl.blur();
					}
				} catch {
					// ignore
				}
			});
			buttonEl?.empty();
			const iconEl = buttonEl?.createSpan({ cls: "epoch-pro-get-pro-icon" });
			if (iconEl) setIcon(iconEl, "epochgram-logo");
			buttonEl?.createSpan({ cls: "epoch-pro-get-pro-label", text: "Get Pro" });
		});
	}

		renderLicenseSetting(proItems);

	const similarityGroup = createSettingGroup(advancedGroupsParentEl, "Similarity");
	similarityGroup.groupEl.classList.add("epoch-similarity-settings-group");
	markLockedHeading(similarityGroup.groupEl);
	const { itemsEl: similaritySection } = similarityGroup;

	const useLinks = plugin.settings.similarityUseLinks !== false;
	const useTags = plugin.settings.similarityUseTags !== false;

	const linksSetting = markLockedRow(new Setting(similaritySection)
		.setName("Use links")
		.setDesc(canSimilarity ? "Includes links and backlinks." : "Requires Epochgram Pro."));
	linksSetting.addToggle((toggle) => {
			const canUse = canSimilarity;
			toggle
				.setValue(canUse ? useLinks : false)
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					plugin.settings.similarityUseLinks = value;
					await plugin.onSettingsChanged("similarityUseLinks");
				});
		});

	const tagsSetting = markLockedRow(new Setting(similaritySection)
		.setName("Use tags")
		.setDesc(canSimilarity ? "Includes shared tags." : "Requires Epochgram Pro."));
	tagsSetting.addToggle((toggle) => {
			const canUse = canSimilarity;
			toggle
				.setValue(canUse ? useTags : false)
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					plugin.settings.similarityUseTags = value;
					await plugin.onSettingsChanged("similarityUseTags");
				});
		});

	{
		const panel = markLockedRow(new Setting(similaritySection));
		let titleThrSlider: SliderComponent | null = null;
		const STEP = 0.01;
		const MIN = 0;
		const MAX = 1;
		const round = (raw: number): number => {
			const n = Number(raw);
			if (!Number.isFinite(n)) return NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
			const clamped = Math.max(MIN, Math.min(MAX, n));
			return Math.round(clamped / STEP) * STEP;
		};
		const rawTitleThr = Number(plugin.settings.similarityTitleJwThreshold);
		const titleThr = canSimilarity
			? Number.isFinite(rawTitleThr)
				? round(rawTitleThr)
				: NOTE_TITLE_SIMILARITY_JW_THRESHOLD
			: 0;
		const setLabel = (val: number) => {
			const rounded = round(val);
			const label = rounded <= 0 ? "disabled" : rounded >= 1 ? "same folder" : rounded.toFixed(2);
			panel.setName(`Title threshold (${label})`);
		};
		setLabel(titleThr);
		panel.setDesc(canSimilarity ? "Includes similar filenames (0 disables, 1.0 = same folder)." : "Requires Epochgram Pro.");
		panel.addSlider((slider) => {
			titleThrSlider = slider;
			const canUse = canSimilarity;
			slider
				.setLimits(MIN, MAX, STEP)
				.setValue(canUse ? titleThr : 0)
				.setDynamicTooltip()
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					const rounded = round(value);
					if (rounded !== value) slider.setValue(rounded);
					plugin.settings.similarityTitleJwThreshold = rounded;
					setLabel(rounded);
					await plugin.onSettingsChanged("similarityTitleJwThreshold");
				});
		});
		registerInfoResetGesture(panel, async () => {
			if (!canSimilarity) return;
			const def = NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
			if (titleThrSlider) titleThrSlider.setValue(def);
			plugin.settings.similarityTitleJwThreshold = def;
			setLabel(def);
			await plugin.onSettingsChanged("similarityTitleJwThreshold");
		});
	}

	{
		const similarityPanel = markLockedRow(new Setting(similaritySection));
		let similaritySlider: SliderComponent | null = null;
		const SIMILARITY_STEP = 0.01;
		const SIMILARITY_MIN = 0;
		const SIMILARITY_MAX = 0.99;
		const roundSimilarity = (raw: number): number => {
			const n = Number(raw);
			if (!Number.isFinite(n)) return DEFAULT_SETTINGS.similarityThreshold;
			if (n >= 1) return 0;
			const clamped = Math.max(SIMILARITY_MIN, Math.min(SIMILARITY_MAX, n));
			return Math.round(clamped / SIMILARITY_STEP) * SIMILARITY_STEP;
		};
		const setSimilarityLabel = (val: number) => {
			const rounded = roundSimilarity(val);
			const label = rounded <= 0 ? "disabled" : rounded.toFixed(2);
			similarityPanel.setName(`Semantic threshold (${label})`);
		};
		const currentSimilarity = roundSimilarity(plugin.settings.similarityThreshold);
		setSimilarityLabel(currentSimilarity);
		const embeddingModelRaw = plugin.settings.similarityEmbeddingModelId;
		const embeddingModelId = typeof embeddingModelRaw === "string" ? embeddingModelRaw.trim() : "";
		const embeddingModel = embeddingModelRaw === NO_SIMILARITY_MODEL
			? "(no model)"
			: (embeddingModelId.length > 0 ? embeddingModelId : DEFAULT_SIMILARITY_MODEL);
		similarityPanel.setDesc(
			canSimilarity
				? `Model: ${embeddingModel}.`
				: "Requires Epochgram Pro."
		);
		similarityPanel.addExtraButton((btn) => {
			btn.setIcon("globe");
			btn.setTooltip("Browse models on huggingface.co");
			btn.setDisabled(!canSimilarity);
			btn.onClick(() => {
				if (!canSimilarity) return;
				void openEmbeddedUrl(HF_SEMANTICS_SEARCH_URL);
			});
		});
		similarityPanel.addExtraButton((btn) => {
			btn.setIcon("settings");
			btn.setTooltip("Semantic model settings");
			btn.setDisabled(!canSimilarity);
			btn.onClick(() => {
				if (!canSimilarity) return;
				new SimilarityModelSuggestModal(app, plugin, { focus: "semantics", onDone: refresh }).open();
			});
		});
		similarityPanel.addSlider((slider) => {
			similaritySlider = slider;
			const canUse = canSimilarity;
			slider
				.setLimits(SIMILARITY_MIN, SIMILARITY_MAX, SIMILARITY_STEP)
				.setValue(canUse ? currentSimilarity : SIMILARITY_MIN)
				.setDynamicTooltip()
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					const rounded = roundSimilarity(value);
					if (rounded !== value) slider.setValue(rounded);
					plugin.settings.similarityThreshold = rounded;
					setSimilarityLabel(rounded);
					await plugin.onSettingsChanged("similarityThreshold");
				});
		});
		registerInfoResetGesture(similarityPanel, async () => {
			if (!canSimilarity) return;
			const def = RESET_PRO_SIMILARITY_THRESHOLD;
			if (similaritySlider) similaritySlider.setValue(def);
			plugin.settings.similarityThreshold = def;
			setSimilarityLabel(def);
			await plugin.onSettingsChanged("similarityThreshold");
		});
	}

	{
		const zeroShotPanel = markLockedRow(new Setting(similaritySection));
		let zeroShotSlider: SliderComponent | null = null;
		const STEP = 0.01;
		const MIN = 0;
		const MAX = 0.99;
		const round = (raw: number): number => {
			const n = Number(raw);
			if (!Number.isFinite(n)) return DEFAULT_SETTINGS.similarityZeroShotMinScore ?? 0;
			if (n >= 1) return 0;
			const clamped = Math.max(MIN, Math.min(MAX, n));
			return Math.round(clamped / STEP) * STEP;
		};
		const rawCurrent = plugin.settings.similarityZeroShotMinScore;
		const current = typeof rawCurrent === "number" && Number.isFinite(rawCurrent)
			? round(rawCurrent)
			: round(DEFAULT_SETTINGS.similarityZeroShotMinScore ?? 0);
		const setLabel = (val: number) => {
			const rounded = round(val);
			const label = rounded <= 0 ? "disabled" : rounded.toFixed(2);
			zeroShotPanel.setName(`Topic threshold (${label})`);
		};
		setLabel(current);
		const zeroShotModelRaw = plugin.settings.similarityZeroShotModelId;
		const zeroShotModelId = typeof zeroShotModelRaw === "string" ? zeroShotModelRaw.trim() : "";
		const zeroShotModel = zeroShotModelRaw === NO_SIMILARITY_MODEL
			? "(no model)"
			: (zeroShotModelId.length > 0 ? zeroShotModelId : DEFAULT_ZERO_SHOT_MODEL);
		zeroShotPanel.setDesc(
			canSimilarity
				? `Model: ${zeroShotModel}.`
				: "Requires Epochgram Pro."
		);
		zeroShotPanel.addExtraButton((btn) => {
			btn.setIcon("globe");
			btn.setTooltip("Browse models on huggingface.co");
			btn.setDisabled(!canSimilarity);
			btn.onClick(() => {
				if (!canSimilarity) return;
				void openEmbeddedUrl(HF_TOPICS_SEARCH_URL);
			});
		});
		zeroShotPanel.addExtraButton((btn) => {
			btn.setIcon("settings");
			btn.setTooltip("Topic model settings");
			btn.setDisabled(!canSimilarity);
			btn.onClick(() => {
				if (!canSimilarity) return;
				new SimilarityModelSuggestModal(app, plugin, { focus: "topics", onDone: refresh }).open();
			});
		});
		zeroShotPanel.addSlider((slider) => {
			zeroShotSlider = slider;
			const canUse = canSimilarity;
			slider
				.setLimits(MIN, MAX, STEP)
				.setValue(canUse ? current : MIN)
				.setDynamicTooltip()
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					const rounded = round(value);
					if (rounded !== value) slider.setValue(rounded);
					plugin.settings.similarityZeroShotMinScore = rounded;
					setLabel(rounded);
					await plugin.onSettingsChanged("similarityZeroShotMinScore");
				});
		});
		registerInfoResetGesture(zeroShotPanel, async () => {
			if (!canSimilarity) return;
			const def = RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE;
			if (zeroShotSlider) zeroShotSlider.setValue(def);
			plugin.settings.similarityZeroShotMinScore = def;
			setLabel(def);
			await plugin.onSettingsChanged("similarityZeroShotMinScore");
		});
	}

	if (Platform.isDesktop) {
		const runtime = plugin as ProPanelRuntime;
		const aiGroup = createSettingGroup(advancedGroupsParentEl, "Generative AI");
		markLockedHeading(aiGroup.groupEl);
		const { itemsEl: aiSection } = aiGroup;

		const summarizeSetting = markLockedRow(new Setting(aiSection)
			.setName("Auto summarize")
			.setDesc(canSummarize ? "Generates record summaries via AI Bridge instead of text starts." : "Requires Epochgram Pro."));
		summarizeSetting.addToggle((toggle) => {
			const canUse = canSummarize;
			toggle
				.setValue(canUse ? plugin.settings.summarizeAI === true : false)
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					const wasEnabled = plugin.settings.summarizeAI === true;
					const nextEnabled = value === true;
					plugin.settings.summarizeAI = nextEnabled;
					await plugin.onSettingsChanged("summarizeAI");
					if (nextEnabled) {
						try {
							await ensureAiBridgeServerRunning(plugin);
							(plugin as { refreshAiBridgeStatusBar?: () => void }).refreshAiBridgeStatusBar?.();
						} catch {
							// ignore
						}
					}
					if (nextEnabled && !wasEnabled) {
						let missingCount = 0;
						try {
							await runtime.ensureIndexLoaded?.();
							const maybeMissing = hasMissingAiSummariesFast(plugin);
							missingCount = maybeMissing ? await countMissingAiSummaries(plugin) : 0;
						} catch {
							missingCount = 0;
						}
						if (missingCount <= 0) return;

						const ok = await confirmModal(app, {
							title: "Generate missing summaries?",
							description: `Run AI summarization for missing notes (${missingCount} jobs).`,
							yesText: "Yes",
							noText: "Later"
						});
						if (ok) {
							try {
								await runtime.generateMissingAiSummariesForAllRecords?.();
							} catch {
								// ignore
							}
						}
					}
				});
		});

		const epochsSetting = markLockedRow(new Setting(aiSection)
			.setName(`Generate ${"Epochs"}`)
			.setDesc(canGenerateEpochs ? "Generates period summaries via AI Bridge." : "Requires Epochgram Pro."));
		epochsSetting.addToggle((toggle) => {
			const canUse = canGenerateEpochs;
			const current = plugin.settings.generateEpochs === true;
			toggle
				.setValue(canUse ? current : false)
				.setDisabled(!canUse)
				.onChange(async (enabled) => {
					if (!canUse) return;
					const prev = plugin.settings.generateEpochs === true;
					const next = enabled === true;
					plugin.settings.generateEpochs = next;
					await plugin.onSettingsChanged("generateEpochs");
					if (next) {
						try {
							await ensureAiBridgeServerRunning(plugin);
							(plugin as { refreshAiBridgeStatusBar?: () => void }).refreshAiBridgeStatusBar?.();
						} catch {
							// ignore
						}
					}
					if (prev === false && next === true) {
						let missingCount = 0;
						try {
							await runtime.ensureIndexLoaded?.();
							missingCount = countMissingEpochsFast(plugin);
						} catch {
							missingCount = 0;
						}
						if (missingCount <= 0) return;

						const ok = await confirmModal(app, {
							title: "Generate missing Epochs?",
							description: `Run AI period summarization for missing Epochs (${missingCount} jobs).`,
							yesText: "Yes",
							noText: "Later"
						});
						if (ok) {
							try {
								await runtime.regenerateMissingEpochsForAllRecords?.();
							} catch {
								// ignore
							}
						}
					}
				});
		});

		const bridgeStartupSetting = markLockedRow(new Setting(aiSection)
			.setName("Open AI bridge on startup")
			.setDesc(
				canAiBridge
					? "Opens automatically on startup and closes it when Obsidian quits."
					: "Requires Epochgram Pro."
			));
		bridgeStartupSetting.addToggle((toggle) => {
			const canUse = canAiBridge;
			toggle
				.setValue(canUse ? plugin.settings.openAiBridgeOnStartup === true : false)
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (!canUse) return;
					plugin.settings.openAiBridgeOnStartup = value;
					await plugin.onSettingsChanged("openAiBridgeOnStartup");
				});
		});

		const bridgeWebViewerSetting = markLockedRow(new Setting(aiSection)
			.setName("Open AI bridge in Obsidian")
			.setDesc(""));
		const reqAtRender = getWebViewerRequirements(app);
		if (canAiBridge && plugin.settings.openAiBridgeInObsidianWebViewer === true && !(reqAtRender.enabled && reqAtRender.openExternalLinks)) {
			plugin.settings.openAiBridgeInObsidianWebViewer = false;
			void plugin.onSettingsChanged("openAiBridgeInObsidianWebViewer");
		}
		const renderBridgeWebViewerDesc = (warningText?: string): void => {
			bridgeWebViewerSetting.descEl.empty();
			if (!canAiBridge) {
				bridgeWebViewerSetting.setDesc("Requires Epochgram Pro.");
				return;
			}
			bridgeWebViewerSetting.descEl.createDiv({
				text: "Opens in Obsidian Web viewer instead of external browser. Works only with cloud providers."
			});
			if (warningText) {
				const warn = bridgeWebViewerSetting.descEl.createDiv({ text: warningText });
				warn.addClass("mod-warning");
			}
		};
		renderBridgeWebViewerDesc();
		let bridgeWebViewerToggleProgrammatic = false;
		bridgeWebViewerSetting.addToggle((toggle) => {
			const canUse = canAiBridge;
			toggle
				.setValue(canUse ? plugin.settings.openAiBridgeInObsidianWebViewer === true : false)
				.setDisabled(!canUse)
				.onChange(async (value) => {
					if (bridgeWebViewerToggleProgrammatic) return;
					if (!canUse) return;
					if (!value) {
						renderBridgeWebViewerDesc();
						plugin.settings.openAiBridgeInObsidianWebViewer = false;
						await plugin.onSettingsChanged("openAiBridgeInObsidianWebViewer");
						return;
					}
					const webViewerReq = getWebViewerRequirements(app);
					if (!(webViewerReq.enabled && webViewerReq.openExternalLinks)) {
						renderBridgeWebViewerDesc("Enable Core plugin Web viewer and turn ON 'Open external links' in Web viewer settings.");
						bridgeWebViewerToggleProgrammatic = true;
						try {
							toggle.setValue(false);
						} finally {
							bridgeWebViewerToggleProgrammatic = false;
						}
						plugin.settings.openAiBridgeInObsidianWebViewer = false;
						await plugin.onSettingsChanged("openAiBridgeInObsidianWebViewer");
						return;
					}
					renderBridgeWebViewerDesc();
					plugin.settings.openAiBridgeInObsidianWebViewer = value;
					await plugin.onSettingsChanged("openAiBridgeInObsidianWebViewer");
				});
		});
	}

		const canCalendarSync = isPro;
		const calendarGroup = createSettingGroup(advancedGroupsParentEl, "Calendar sync");
		calendarGroup.groupEl.classList.add("epoch-calendar-settings-group");
		markLockedHeading(calendarGroup.groupEl);
		const { itemsEl: calendarSection } = calendarGroup;
		const docsUrl = "https://www.epochgram.com/docs#calendar-sync-pro";
		try {
			const simEl = advancedGroupsParentEl.querySelector(":scope > .setting-group.epoch-similarity-settings-group");
			if (simEl && simEl !== calendarGroup.groupEl) {
				advancedGroupsParentEl.insertBefore(calendarGroup.groupEl, simEl);
			}
		} catch {
			// ignore
		}

		const isValidCalendarUrl = (raw: string): boolean => {
			const value = String(raw ?? "").trim();
			if (!value) return false;
			try {
				const resolved = resolveSecretPlaceholders(value, (id: string) => {
					try {
						return plugin.app.secretStorage.getSecret(String(id || ""));
					} catch {
						return null;
					}
				});
				const parsed = new URL(resolved.replace(/^webcal:/i, "https:"));
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		};
		const normalizeStoredUrls = (): string[] => {
			const raw = plugin.settings.calendarSyncIcsUrls;
			if (!Array.isArray(raw)) return [];
			const out: string[] = [];
			for (const v of raw) {
				const s = String(v ?? "").trim();
				if (!isValidCalendarUrl(s)) continue;
				const normalized = s;
				if (!out.includes(normalized)) out.push(normalized);
			}
			return out;
		};
		const saveCalendarUrls = async (urls: string[]): Promise<void> => {
			if (!canCalendarSync) return;
			const next = urls.map((v) => String(v ?? "").trim()).filter(Boolean);
			const prev = normalizeStoredUrls();
			if (JSON.stringify(prev) === JSON.stringify(next)) return;
			plugin.settings.calendarSyncIcsUrls = next;
			await plugin.onSettingsChanged("calendarSyncIcsUrls");
			refreshWithoutScroll();
		};

		const currentUrls = normalizeStoredUrls();
		const urlRows = currentUrls.length > 0 ? [...currentUrls, ""] : [""];
		const calendarLinksSetting = markLockedRow(new Setting(calendarSection)
			.setName("ICS link")
			.setDesc(canCalendarSync ? "" : "Requires Epochgram Pro."));
		calendarLinksSetting.settingEl?.classList?.add("epoch-calendar-links-setting");
		if (canCalendarSync) {
			calendarLinksSetting.descEl.empty();
			const link = calendarLinksSetting.descEl.createEl("a", {
				text: "Read docs",
				href: docsUrl
			});
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener noreferrer");
		}
		for (let i = 0; i < urlRows.length; i++) {
			calendarLinksSetting.addText((text: TextComponent) => {
				const value = String(urlRows[i] ?? "").trim();
				text.inputEl.classList.add("epoch-calendar-link-input");
				text
					.setPlaceholder("https://example.com/calendar.ics")
					.setValue(value)
					.setDisabled(!canCalendarSync)
					.onChange((changed) => {
						const normalized = String(changed ?? "").trim();
						const valid = normalized.length === 0 || isValidCalendarUrl(normalized);
						text.inputEl.classList.toggle("epoch-invalid-url-input", !valid);
					});
				text.inputEl.classList.toggle("epoch-invalid-url-input", value.length > 0 && !isValidCalendarUrl(value));
				text.inputEl.addEventListener("blur", () => {
					void (async () => {
						if (!canCalendarSync) return;
						const typed = String(text.getValue() ?? "").trim();
						if (!typed) {
							const next = normalizeStoredUrls();
							if (i < next.length) {
								next.splice(i, 1);
								await saveCalendarUrls(next);
							}
							return;
						}
						if (!isValidCalendarUrl(typed)) {
							text.inputEl.classList.add("epoch-invalid-url-input");
							return;
						}
						text.inputEl.classList.remove("epoch-invalid-url-input");
						const normalized = typed;
						const next = normalizeStoredUrls();
						if (i < next.length) next[i] = normalized;
						else next.push(normalized);
						const deduped: string[] = [];
						for (const v of next) {
							if (!v || deduped.includes(v)) continue;
							deduped.push(v);
						}
						await saveCalendarUrls(deduped);
					})();
				});
			});
		}

		let calendarPeriodDropdown: DropdownComponent | null = null;
		const normalizePeriod = (raw: unknown): string => {
			const rawText = typeof raw === "string"
				? raw
				: (typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "");
			const value = rawText.trim().toLowerCase();
			switch (value) {
				case "manual":
				case "startup":
				case "1m":
				case "5m":
				case "15m":
				case "1h":
				case "6h":
				case "24h":
					return value;
				default:
					return "manual";
			}
		};
		const periodSetting = markLockedRow(new Setting(calendarSection)
			.setName("Sync period")
			.setDesc(canCalendarSync ? "Manual, startup, or fixed interval sync." : "Requires Epochgram Pro."));
		periodSetting.addDropdown((dropdown) => {
			calendarPeriodDropdown = dropdown;
			dropdown
				.addOption("manual", "Manual")
				.addOption("startup", "On startup")
				.addOption("1m", "Every 1 min")
				.addOption("5m", "Every 5 min")
				.addOption("15m", "Every 15 min")
				.addOption("1h", "Every 1 hour")
				.addOption("6h", "Every 6 hours")
				.addOption("24h", "Every 24 hours")
				.setValue(canCalendarSync ? normalizePeriod(plugin.settings.calendarSyncPeriod) : "manual")
				.setDisabled(!canCalendarSync)
				.onChange(async (value) => {
					if (!canCalendarSync) return;
					const next = normalizePeriod(value);
					if (normalizePeriod(plugin.settings.calendarSyncPeriod) === next) return;
					plugin.settings.calendarSyncPeriod = next as "manual" | "startup" | "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
					await plugin.onSettingsChanged("calendarSyncPeriod");
				});
		});
		registerInfoResetGesture(periodSetting, async () => {
			if (!canCalendarSync) return;
			plugin.settings.calendarSyncPeriod = "manual";
			if (calendarPeriodDropdown) calendarPeriodDropdown.setValue("manual");
			await plugin.onSettingsChanged("calendarSyncPeriod");
		});

		let folderText: TextComponent | null = null;
		let folderPending = String(plugin.settings.calendarSyncFolder ?? "").trim();
		const folderSetting = markLockedRow(new Setting(calendarSection)
			.setName("Event file location")
			.setDesc(canCalendarSync ? "Default uses Daily Notes folder." : "Requires Epochgram Pro."));
		folderSetting.addText((text) => {
			folderText = text;
			new FolderPathSuggest(app, text.inputEl);
			text
				.setPlaceholder(canCalendarSync ? String(plugin.getDailyNoteFolder() || "/") : "")
				.setValue(canCalendarSync ? folderPending : "")
				.setDisabled(!canCalendarSync)
				.onChange((value) => {
					folderPending = String(value ?? "");
				});
			text.inputEl.addEventListener("blur", () => {
				void (async () => {
					if (!canCalendarSync) return;
					const normalized = String(folderPending ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
					folderPending = normalized;
					if (folderText && folderText.getValue() !== normalized) folderText.setValue(normalized);
					if (String(plugin.settings.calendarSyncFolder ?? "").trim() === normalized) return;
					plugin.settings.calendarSyncFolder = normalized;
					await plugin.onSettingsChanged("calendarSyncFolder");
				})();
			});
		});

		let templateText: TextComponent | null = null;
		let templatePending = String(plugin.settings.calendarSyncTemplatePath ?? "").trim();
		const templateSetting = markLockedRow(new Setting(calendarSection)
			.setName("Template file location")
			.setDesc(canCalendarSync ? "Template file path for the event note." : "Requires Epochgram Pro."));
		templateSetting.addText((text) => {
			templateText = text;
			new FilePathSuggest(app, text.inputEl);
			text
				.setPlaceholder("")
				.setValue(canCalendarSync ? templatePending : "")
				.setDisabled(!canCalendarSync)
				.onChange((value) => {
					templatePending = String(value ?? "");
				});
			text.inputEl.addEventListener("blur", () => {
				void (async () => {
					if (!canCalendarSync) return;
					const normalized = String(templatePending ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
					templatePending = normalized;
					if (templateText && templateText.getValue() !== normalized) templateText.setValue(normalized);
					if (String(plugin.settings.calendarSyncTemplatePath ?? "").trim() === normalized) return;
					plugin.settings.calendarSyncTemplatePath = normalized;
					await plugin.onSettingsChanged("calendarSyncTemplatePath");
				})();
			});
		});

	// Keep a lightweight “proof” we’re still in the same render path.
	void formatDate;
}
