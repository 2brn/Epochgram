import { setIcon } from "obsidian";
import type { EpochPlugin } from "../../main";

import { setButtonState } from "./filter-ui";
import { isTrackChangesConfigured } from "../../plugin/pro-feature-state";

export type EpochViewPreferences = {
	showDraftsOnly?: boolean;
	showAttachments: boolean;
	showTrackedChanges?: boolean;
	showParsed?: boolean;
	showEpochsView?: boolean;
};

type TimelineFiltersPatch = {
	showAttachments?: boolean;
	showTrackedChanges?: boolean;
	showParsed?: boolean;
};

type TimelineFiltersLike = {
	showAttachments?: boolean;
	showTrackedChanges?: boolean;
	showParsed?: boolean;
};

type EpochViewPluginLike = {
	settings?: {
		[key: string]: unknown;
		parseDatesInFrontmatter?: boolean;
		timelineFilters?: TimelineFiltersLike;
	};
	viewPreferences?: EpochViewPreferences;
	notifyProFeature?: (feature: string) => void;
	saveSettings?: () => Promise<void> | void;
};

type EpochViewLike = {
	plugin?: EpochViewPluginLike;
	canvas?: {
		setShowContentDates?: (value: boolean) => void;
		setShowPropDates?: (value: boolean) => void;
		setShowTrackedChanges?: (value: boolean) => void;
		setShowAttachments?: (value: boolean) => void;
		setReviewFilterMode?: (mode: "reviewed+draft" | "draft") => void;
		setEpochsView?: (value: boolean) => void;
	};
	buttonReview?: HTMLElement | null;
	buttonAttachments?: HTMLElement | null;
	buttonEdits?: HTMLElement | null;
	buttonParsed?: HTMLElement | null;
	buttonEpochs?: HTMLElement | null;
	showDraftsOnly?: boolean;
	showAttachments: boolean;
	showTrackedChanges?: boolean;
	showContentDates?: boolean;
	showPropDates?: boolean;
	showEpochsView?: boolean;
	hasSyncedEpochEntries?: boolean;
	reviewFilterMode?: "reviewed+draft" | "draft";
	refreshSyncedEpochAvailability: () => void;
	isPro: () => boolean;
	isEpochsEnabled: () => boolean;
	scheduleSearchControlRefresh?: () => void;
};

function asView(view: unknown): EpochViewLike {
	return view as EpochViewLike;
}

function persistTimelineFilterPatch(view: EpochViewLike, patch: TimelineFiltersPatch): void {
	const plugin = view.plugin;
	const settings = plugin?.settings;
	if (!plugin || !settings) return;
	try {
		const current = settings.timelineFilters;
		const baseRaw = current && typeof current === "object" ? current : {};
		const base: TimelineFiltersLike = {
			showAttachments: baseRaw.showAttachments === true,
			showTrackedChanges: baseRaw.showTrackedChanges !== false,
			showParsed: baseRaw.showParsed !== false
		};
		const allowed: TimelineFiltersPatch = {};
		if (Object.prototype.hasOwnProperty.call(patch, "showAttachments")) allowed.showAttachments = patch.showAttachments;
		if (Object.prototype.hasOwnProperty.call(patch, "showTrackedChanges")) allowed.showTrackedChanges = patch.showTrackedChanges;
		if (Object.prototype.hasOwnProperty.call(patch, "showParsed")) allowed.showParsed = patch.showParsed;

		const next = Object.assign({}, base, allowed);
		settings.timelineFilters = next;
		if (typeof plugin.saveSettings === "function") {
			void plugin.saveSettings();
		}
	} catch {
		// ignore
	}
}

function getShowParsedFromView(view: EpochViewLike): boolean {
	return !!view?.showContentDates;
}

function applyShowParsedToView(view: EpochViewLike, showParsed: boolean): void {
	const nextShowParsed = !!showParsed;
	view.showContentDates = nextShowParsed;
	view.showPropDates = nextShowParsed && view?.plugin?.settings?.parseDatesInFrontmatter === true;
	try {
		view.canvas?.setShowContentDates?.(view.showContentDates);
	} catch {
		// ignore
	}
	try {
		view.canvas?.setShowPropDates?.(view.showPropDates);
	} catch {
		// ignore
	}
	try {
		if (view.plugin?.viewPreferences) {
			view.plugin.viewPreferences.showParsed = nextShowParsed;
		}
	} catch {
		// ignore
	}
}

export function epochViewUpdateProUiState(view: unknown): void {
	const v = asView(view);
	const pro = v.isPro();
	const forceRuntimeTrackedOff = () => {
		if (!v.showTrackedChanges) return;
		v.showTrackedChanges = false;
		try {
			v.canvas?.setShowTrackedChanges?.(false);
		} catch {
			// ignore
		}
		try {
			if (v.plugin?.viewPreferences) {
				v.plugin.viewPreferences.showTrackedChanges = false;
			}
		} catch {
			// ignore
		}
	};
	if (!pro) {
		if (v.showTrackedChanges) {
			forceRuntimeTrackedOff();
		}
		if (v.showEpochsView) {
			epochViewSetShowEpochsView(v, false);
		}
	} else {
		const epochsAvailable = v.isEpochsEnabled() && v.hasSyncedEpochEntries;
		if (!epochsAvailable && v.showEpochsView) {
			epochViewSetShowEpochsView(v, false);
		}
	}
	epochViewUpdateFilterButtons(v);
}

export function epochViewSyncPreferencesFromPlugin(view: unknown, preferences: EpochViewPreferences): void {
	const v = asView(view);
	const nextMode: "reviewed+draft" | "draft" = preferences.showDraftsOnly === true ? "draft" : "reviewed+draft";
	const nextAttachments = !!preferences.showAttachments;
	const nextTracked = preferences.showTrackedChanges !== false;
	const nextShowParsed = preferences.showParsed !== false;
	const nextEpochsView = preferences.showEpochsView === true;

	epochViewSetReviewFilterMode(v, nextMode);
	epochViewSetShowAttachments(v, nextAttachments);
	epochViewSetShowTrackedChanges(v, nextTracked);
	applyShowParsedToView(v, nextShowParsed);
	epochViewSetShowEpochsView(v, nextEpochsView);
	epochViewUpdateProUiState(v);
}

export function epochViewUpdateFilterButtons(view: unknown): void {
	const v = asView(view);
	v.refreshSyncedEpochAvailability();

	const reviewMode: "reviewed+draft" | "draft" = String(v.reviewFilterMode || "reviewed+draft") === "draft"
		? "draft"
		: "reviewed+draft";
	setButtonState(v.buttonReview ?? null, reviewMode !== "reviewed+draft");
	epochViewUpdateReviewFilterButtonUi(v, reviewMode);
	setButtonState(v.buttonAttachments ?? null, !!v.showAttachments);
	epochViewUpdateAttachmentsFilterButtonUi(v);
	const pro = v.isPro();
	const trackChangesConfigured = isTrackChangesConfigured(v.plugin as unknown as EpochPlugin);
	const editsAvailable = pro && trackChangesConfigured;
	const editsActive = editsAvailable && !!v.showTrackedChanges;
	setButtonState(v.buttonEdits ?? null, editsActive);
	try { if (v.buttonEdits) v.buttonEdits.style.display = editsAvailable ? "" : "none"; } catch { /* ignore */ }
	epochViewUpdateTrackedFilterButtonUi(v);
	setButtonState(v.buttonParsed ?? null, !!v.showContentDates);
	epochViewUpdateParsedFilterButtonUi(v);
	// Keep button labels/tooltips consistent with the historical filter panel.
	setButtonState(v.buttonEpochs ?? null, !!v.showEpochsView);
	epochViewUpdateEpochsFilterButtonUi(v);
	const epochsAvailable = pro && v.isEpochsEnabled() && v.hasSyncedEpochEntries;
	if (!epochsAvailable && v.showEpochsView) {
		epochViewSetShowEpochsView(v, false);
	}
	try { if (v.buttonEpochs) v.buttonEpochs.style.display = epochsAvailable ? "" : "none"; } catch { /* ignore */ }
}

export function epochViewUpdateTrackedFilterButtonUi(view: unknown): void {
	const v = asView(view);
	const button = v.buttonEdits;
	if (!button) return;
	const showTracked = !!v.showTrackedChanges;
	const tooltip = showTracked ? "Show tracked changes" : "No tracked changes";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
}

export function epochViewUpdateAttachmentsFilterButtonUi(view: unknown): void {
	const v = asView(view);
	const button = v.buttonAttachments;
	if (!button) return;
	const showAttachments = !!v.showAttachments;
	const tooltip = showAttachments ? "Show attachments" : "No attachments";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
}

export function epochViewUpdateReviewFilterButtonUi(view: unknown, mode: "reviewed+draft" | "draft"): void {
	const v = asView(view);
	const button = v.buttonReview;
	if (!button) return;
	const iconEl = button.querySelector<HTMLElement>(".epoch-filter-button-icon");
	const tooltip = mode === "draft" ? "Drafts only" : "Reviewed & drafts";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
	try {
		if (iconEl) {
			setIcon(iconEl, mode === "draft" ? "scan-eye" : "scan-eye");
		}
	} catch {
		// ignore
	}
}

export function epochViewUpdateParsedFilterButtonUi(view: unknown): void {
	const v = asView(view);
	const button = v.buttonParsed;
	if (!button) return;
	const iconEl = button.querySelector<HTMLElement>(".epoch-filter-button-icon");
	const showParsed = !!v.showContentDates;
	const tooltip = !showParsed
		? "No content dates"
		: "Show content dates";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
	try {
		if (iconEl) {
			setIcon(iconEl, "calendar");
		}
	} catch {
		// ignore
	}
}

export function epochViewUpdateEpochsFilterButtonUi(view: unknown): void {
	const v = asView(view);
	const button = v.buttonEpochs;
	if (!button) return;
	try {
		button.setAttribute("aria-label", v.showEpochsView ? "Epochs on" : "Epochs off");
	} catch {
		// ignore
	}
}

export function epochViewSetShowEpochsView(view: unknown, value: boolean): void {
	const v = asView(view);
	const next = !!value && v.isEpochsEnabled();
	if (v.showEpochsView === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.showEpochsView = next;
	v.canvas?.setEpochsView?.(v.showEpochsView);
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showEpochsView = v.showEpochsView;
	}
	epochViewUpdateFilterButtons(v);
	try {
		v.scheduleSearchControlRefresh?.();
	} catch {
		// ignore
	}
}

export function epochViewCycleReviewFilterMode(view: unknown): void {
	const v = asView(view);
	const current = v.reviewFilterMode;
	const next = current === "reviewed+draft" ? "draft" : "reviewed+draft";
	epochViewSetReviewFilterMode(v, next);
}

export function epochViewSetReviewFilterMode(view: unknown, mode: "reviewed+draft" | "draft"): void {
	const v = asView(view);
	const next = mode === "draft" || mode === "reviewed+draft" ? mode : "reviewed+draft";
	if (v.reviewFilterMode === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.reviewFilterMode = next;
	v.canvas?.setReviewFilterMode?.(v.reviewFilterMode);
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showDraftsOnly = v.reviewFilterMode === "draft";
	}
	epochViewUpdateFilterButtons(v);
}

export function epochViewSetShowTrackedChanges(view: unknown, value: boolean): void {
	const v = asView(view);
	if (!v.isPro() && value === true) {
		v.plugin?.notifyProFeature?.("Filtering tracked changes");
		value = false;
	}
	const next = !!value;
	if (v.showTrackedChanges === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.showTrackedChanges = next;
	v.canvas?.setShowTrackedChanges?.(v.showTrackedChanges);
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showTrackedChanges = v.showTrackedChanges;
	}
	persistTimelineFilterPatch(v, { showTrackedChanges: v.showTrackedChanges });
	epochViewUpdateFilterButtons(v);
}

export function epochViewSetShowContentDates(view: unknown, value: boolean): void {
	const v = asView(view);
	const next = !!value;
	if (v.showContentDates === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.showContentDates = next;
	v.canvas?.setShowContentDates?.(v.showContentDates);
	const nextShowPropDates = v.showContentDates && v?.plugin?.settings?.parseDatesInFrontmatter === true;
	if (v.showPropDates !== nextShowPropDates) {
		v.showPropDates = nextShowPropDates;
		try {
			v.canvas?.setShowPropDates?.(nextShowPropDates);
		} catch {
			// ignore
		}
	}
	if (!v.showContentDates && v.showPropDates) {
		v.showPropDates = false;
		try {
			v.canvas?.setShowPropDates?.(false);
		} catch {
			// ignore
		}
	}
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showParsed = getShowParsedFromView(v);
	}
	persistTimelineFilterPatch(v, { showParsed: getShowParsedFromView(v) });
	epochViewUpdateFilterButtons(v);
}

export function epochViewSetShowPropDates(view: unknown, value: boolean): void {
	const v = asView(view);
	const next = !!value && v?.plugin?.settings?.parseDatesInFrontmatter === true;
	if (next && !v.showContentDates) {
		v.showContentDates = true;
		try {
			v.canvas?.setShowContentDates?.(true);
		} catch {
			// ignore
		}
		if (v.plugin?.viewPreferences) {
			v.plugin.viewPreferences.showParsed = getShowParsedFromView(v);
		}
	}
	if (v.showPropDates === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.showPropDates = next;
	v.canvas?.setShowPropDates?.(v.showPropDates);
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showParsed = getShowParsedFromView(v);
	}
	persistTimelineFilterPatch(v, { showParsed: getShowParsedFromView(v) });
	epochViewUpdateFilterButtons(v);
}

export function epochViewSetShowAttachments(view: unknown, value: boolean): void {
	const v = asView(view);
	const next = !!value;
	if (v.showAttachments === next) {
		epochViewUpdateFilterButtons(v);
		return;
	}
	v.showAttachments = next;
	v.canvas?.setShowAttachments?.(v.showAttachments);
	if (v.plugin?.viewPreferences) {
		v.plugin.viewPreferences.showAttachments = v.showAttachments;
	}
	persistTimelineFilterPatch(v, { showAttachments: v.showAttachments });
	epochViewUpdateFilterButtons(v);
}
