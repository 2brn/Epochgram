import { setIcon } from "obsidian";

import { setButtonState } from "./filter-ui";
import { isTrackChangesConfigured } from "../../plugin/pro-feature-state";

export type EpochViewPreferences = {
	showDraftsOnly?: boolean;
	showAttachments: boolean;
	showTrackedChanges?: boolean;
	showParsed?: boolean;
	showEpochsView?: boolean;
};

function persistTimelineFilterPatch(view: any, patch: Record<string, any>): void {
	const plugin: any = view?.plugin;
	const settings: any = plugin?.settings;
	if (!plugin || !settings) return;
	try {
		const current: any = settings?.timelineFilters;
		const baseRaw = current && typeof current === "object" ? current : {};
		const base: any = {
			showDraftsOnly: baseRaw.showDraftsOnly === true,
			showAttachments: baseRaw.showAttachments === true,
			showTrackedChanges: baseRaw.showTrackedChanges !== false,
			showParsed: baseRaw.showParsed !== false
		};
		const allowed: any = {};
		if (Object.prototype.hasOwnProperty.call(patch, "showDraftsOnly")) allowed.showDraftsOnly = patch.showDraftsOnly;
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

function getShowParsedFromView(view: any): boolean {
	return !!view?.showContentDates;
}

function applyShowParsedToView(view: any, showParsed: boolean): void {
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

export function epochViewUpdateProUiState(view: any): void {
	const pro = view.isPro();
	const forceRuntimeTrackedOff = () => {
		if (!view.showTrackedChanges) return;
		view.showTrackedChanges = false;
		try {
			view.canvas?.setShowTrackedChanges(false);
		} catch {
			// ignore
		}
		try {
			if (view.plugin?.viewPreferences) {
				view.plugin.viewPreferences.showTrackedChanges = false;
			}
		} catch {
			// ignore
		}
	};
	if (!pro) {
		if (view.showTrackedChanges) {
			forceRuntimeTrackedOff();
		}
		if (view.showEpochsView) {
			epochViewSetShowEpochsView(view, false);
		}
	} else {
		const epochsAvailable = view.isEpochsEnabled() && view.hasSyncedEpochEntries;
		if (!epochsAvailable && view.showEpochsView) {
			epochViewSetShowEpochsView(view, false);
		}
	}
	epochViewUpdateFilterButtons(view);
}

export function epochViewSyncPreferencesFromPlugin(view: any, preferences: EpochViewPreferences): void {
	const nextMode: "reviewed+draft" | "draft" = preferences.showDraftsOnly === true ? "draft" : "reviewed+draft";
	const nextAttachments = !!preferences.showAttachments;
	const nextTracked = preferences.showTrackedChanges !== false;
	const nextShowParsed = preferences.showParsed !== false;
	const nextEpochsView = preferences.showEpochsView === true;

	epochViewSetReviewFilterMode(view, nextMode);
	epochViewSetShowAttachments(view, nextAttachments);
	epochViewSetShowTrackedChanges(view, nextTracked);
	applyShowParsedToView(view, nextShowParsed);
	epochViewSetShowEpochsView(view, nextEpochsView);
	epochViewUpdateProUiState(view);
}

export function epochViewUpdateFilterButtons(view: any): void {
	view.refreshSyncedEpochAvailability();

	const reviewMode: "reviewed+draft" | "draft" = String(view.reviewFilterMode || "reviewed+draft") === "draft"
		? "draft"
		: "reviewed+draft";
	setButtonState(view.buttonReview, reviewMode !== "reviewed+draft");
	epochViewUpdateReviewFilterButtonUi(view, reviewMode);
	setButtonState(view.buttonAttachments, !!view.showAttachments);
	epochViewUpdateAttachmentsFilterButtonUi(view);
	const pro = view.isPro();
	const trackChangesConfigured = isTrackChangesConfigured(view.plugin);
	const editsAvailable = pro && trackChangesConfigured;
	const editsActive = editsAvailable && !!view.showTrackedChanges;
	setButtonState(view.buttonEdits, editsActive);
	try { if (view.buttonEdits) (view.buttonEdits as HTMLElement).style.display = editsAvailable ? "" : "none"; } catch { /* ignore */ }
	epochViewUpdateTrackedFilterButtonUi(view);
	setButtonState(view.buttonParsed, !!view.showContentDates);
	epochViewUpdateParsedFilterButtonUi(view);
	// Keep button labels/tooltips consistent with the historical filter panel.
	setButtonState(view.buttonEpochs, view.showEpochsView);
	epochViewUpdateEpochsFilterButtonUi(view);
	const epochsAvailable = pro && view.isEpochsEnabled() && view.hasSyncedEpochEntries;
	if (!epochsAvailable && view.showEpochsView) {
		epochViewSetShowEpochsView(view, false);
	}
	try { if (view.buttonEpochs) (view.buttonEpochs as HTMLElement).style.display = epochsAvailable ? "" : "none"; } catch { /* ignore */ }
}

export function epochViewUpdateTrackedFilterButtonUi(view: any): void {
	const button = view.buttonEdits;
	if (!button) return;
	const showTracked = !!view.showTrackedChanges;
	const tooltip = showTracked ? "Tracked changes" : "No tracked changes";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
}

export function epochViewUpdateAttachmentsFilterButtonUi(view: any): void {
	const button = view.buttonAttachments;
	if (!button) return;
	const showAttachments = !!view.showAttachments;
	const tooltip = showAttachments ? "Attachments" : "No attachments";
	try {
		button.setAttribute("aria-label", tooltip);
	} catch {
		// ignore
	}
}

export function epochViewUpdateReviewFilterButtonUi(view: any, mode: "reviewed+draft" | "draft"): void {
	const button = view.buttonReview;
	if (!button) return;
	const iconEl = button.querySelector(".epoch-filter-button-icon") as HTMLElement | null;
	const tooltip = mode === "draft" ? "Drafts" : "Reviewed & Drafts";
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

export function epochViewUpdateParsedFilterButtonUi(view: any): void {
	const button = view.buttonParsed;
	if (!button) return;
	const iconEl = button.querySelector(".epoch-filter-button-icon") as HTMLElement | null;
	const showParsed = !!view.showContentDates;
	const tooltip = !showParsed
		? "No parsed content"
		: "Parsed content";
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

export function epochViewUpdateEpochsFilterButtonUi(view: any): void {
	const button = view.buttonEpochs;
	if (!button) return;
	try {
		button.setAttribute("aria-label", view.showEpochsView ? "Epochs on" : "Epochs off");
	} catch {
		// ignore
	}
}

export function epochViewSetShowEpochsView(view: any, value: boolean): void {
	const next = !!value && view.isEpochsEnabled();
	if (view.showEpochsView === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.showEpochsView = next;
	view.canvas?.setEpochsView(view.showEpochsView);
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showEpochsView = view.showEpochsView;
	}
	epochViewUpdateFilterButtons(view);
	try {
		view.scheduleSearchControlRefresh?.();
	} catch {
		// ignore
	}
}

export function epochViewCycleReviewFilterMode(view: any): void {
	const current = view.reviewFilterMode;
	const next = current === "reviewed+draft" ? "draft" : "reviewed+draft";
	epochViewSetReviewFilterMode(view, next);
}

export function epochViewSetReviewFilterMode(view: any, mode: "reviewed+draft" | "draft"): void {
	const next = mode === "draft" || mode === "reviewed+draft" ? mode : "reviewed+draft";
	if (view.reviewFilterMode === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.reviewFilterMode = next;
	view.canvas?.setReviewFilterMode(view.reviewFilterMode);
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showDraftsOnly = view.reviewFilterMode === "draft";
	}
	persistTimelineFilterPatch(view, { showDraftsOnly: view.reviewFilterMode === "draft" });
	epochViewUpdateFilterButtons(view);
}

export function epochViewSetShowTrackedChanges(view: any, value: boolean): void {
	if (!view.isPro() && value === true) {
		view.plugin?.notifyProFeature?.("Filtering tracked changes");
		value = false;
	}
	const next = !!value;
	if (view.showTrackedChanges === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.showTrackedChanges = next;
	view.canvas?.setShowTrackedChanges(view.showTrackedChanges);
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showTrackedChanges = view.showTrackedChanges;
	}
	persistTimelineFilterPatch(view, { showTrackedChanges: view.showTrackedChanges });
	epochViewUpdateFilterButtons(view);
}

export function epochViewSetShowContentDates(view: any, value: boolean): void {
	const next = !!value;
	if (view.showContentDates === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.showContentDates = next;
	view.canvas?.setShowContentDates(view.showContentDates);
	const nextShowPropDates = view.showContentDates && view?.plugin?.settings?.parseDatesInFrontmatter === true;
	if (view.showPropDates !== nextShowPropDates) {
		view.showPropDates = nextShowPropDates;
		try {
			view.canvas?.setShowPropDates(nextShowPropDates);
		} catch {
			// ignore
		}
	}
	if (!view.showContentDates && view.showPropDates) {
		view.showPropDates = false;
		try {
			view.canvas?.setShowPropDates(false);
		} catch {
			// ignore
		}
	}
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showParsed = getShowParsedFromView(view);
	}
	persistTimelineFilterPatch(view, { showParsed: getShowParsedFromView(view) });
	epochViewUpdateFilterButtons(view);
}

export function epochViewSetShowPropDates(view: any, value: boolean): void {
	const next = !!value && view?.plugin?.settings?.parseDatesInFrontmatter === true;
	if (next && !view.showContentDates) {
		view.showContentDates = true;
		try {
			view.canvas?.setShowContentDates(true);
		} catch {
			// ignore
		}
		if (view.plugin?.viewPreferences) {
			view.plugin.viewPreferences.showParsed = getShowParsedFromView(view);
		}
	}
	if (view.showPropDates === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.showPropDates = next;
	view.canvas?.setShowPropDates(view.showPropDates);
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showParsed = getShowParsedFromView(view);
	}
	persistTimelineFilterPatch(view, { showParsed: getShowParsedFromView(view) });
	epochViewUpdateFilterButtons(view);
}

export function epochViewSetShowAttachments(view: any, value: boolean): void {
	const next = !!value;
	if (view.showAttachments === next) {
		epochViewUpdateFilterButtons(view);
		return;
	}
	view.showAttachments = next;
	view.canvas?.setShowAttachments(view.showAttachments);
	if (view.plugin?.viewPreferences) {
		view.plugin.viewPreferences.showAttachments = view.showAttachments;
	}
	persistTimelineFilterPatch(view, { showAttachments: view.showAttachments });
	epochViewUpdateFilterButtons(view);
}
