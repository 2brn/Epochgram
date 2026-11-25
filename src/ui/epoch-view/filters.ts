import type { EpochPlugin } from "../../main";
import { setButtonState } from "./filter-ui";
export type EpochViewPreferences = { showAttachments: boolean; showParsed?: boolean; showDraftsOnly?: boolean };
type View = {
	plugin?: EpochPlugin;
	canvas?: { setShowDraftsOnly?: (value: boolean) => void; setShowContentDates?: (value: boolean) => void; setShowPropDates?: (value: boolean) => void; setShowAttachments?: (value: boolean) => void };
	buttonAttachments?: HTMLElement | null; buttonParsed?: HTMLElement | null; buttonDrafts?: HTMLElement | null;
	showAttachments: boolean; showContentDates: boolean; showPropDates: boolean; showDraftsOnly?: boolean;
	scheduleSearchControlRefresh?: () => void;
};
function apply(view: View, persist = true): void {
	view.showPropDates = view.showContentDates && view.plugin?.settings.parseDatesInFrontmatter === true;
	view.canvas?.setShowContentDates?.(view.showContentDates);
	view.canvas?.setShowPropDates?.(view.showPropDates);
	view.canvas?.setShowAttachments?.(view.showAttachments);
	view.canvas?.setShowDraftsOnly?.(view.showDraftsOnly === true);
	if (view.plugin) {
		view.plugin.viewPreferences = { showAttachments: view.showAttachments, showParsed: view.showContentDates, showDraftsOnly: view.showDraftsOnly === true };
		if (persist) { view.plugin.settings.timelineFilters = { showAttachments: view.showAttachments, showParsed: view.showContentDates }; void view.plugin.saveSettings(); }
	}
	epochViewUpdateFilterButtons(view);
	view.scheduleSearchControlRefresh?.();
}
export function epochViewSyncPreferencesFromPlugin(view: unknown, preferences: EpochViewPreferences): void {
	const v = view as View;
	v.showAttachments = preferences.showAttachments;
	v.showContentDates = preferences.showParsed !== false;
	v.showDraftsOnly = preferences.showDraftsOnly === true;
	apply(v, false);
}
export function epochViewUpdateFilterButtons(view: unknown): void {
	const v = view as View;
	setButtonState(v.buttonAttachments ?? null, v.showAttachments);
	setButtonState(v.buttonParsed ?? null, v.showContentDates);
	setButtonState(v.buttonDrafts ?? null, v.showDraftsOnly === true);
	v.buttonDrafts?.setAttribute("aria-label", v.showDraftsOnly ? "Drafts only" : "Reviewed & drafts");
	v.buttonAttachments?.setAttribute("aria-label", v.showAttachments ? "Show attachments" : "No attachments");
	v.buttonParsed?.setAttribute("aria-label", v.showContentDates ? "Show content dates" : "No content dates");
}
export function epochViewSetShowContentDates(view: unknown, value: boolean): void { const v = view as View; v.showContentDates = value; apply(v); }
export function epochViewSetShowPropDates(view: unknown, value: boolean): void { const v = view as View; if (value) v.showContentDates = true; apply(v); }
export function epochViewSetShowDraftsOnly(view: unknown, value: boolean): void { const v = view as View; v.showDraftsOnly = value; apply(v, false); v.plugin?.refreshEpochViews?.(); }
export function epochViewSetShowAttachments(view: unknown, value: boolean): void { const v = view as View; v.showAttachments = value; apply(v); }
