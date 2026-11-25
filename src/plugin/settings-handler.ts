import type { EpochSettings } from "../settings";
import type { EpochPlugin } from "../main";
export interface SettingsHandlerMethods { onSettingsChanged(key: keyof EpochSettings): Promise<void>; }
export const settingsHandlerMethods: SettingsHandlerMethods = {
	async onSettingsChanged(this: EpochPlugin, key) {
		await this.saveSettings();
		if (["summaryWordsCount", "anchorMdate", "parseDatesInFrontmatter", "yamlDateProperty", "yamlDescriptionProperty"].includes(key)) await this.refreshIndexSmartWithProgress({ suppressNotices: true });
		if (["similarityUseLinks", "similarityUseTags", "similarityTitleJwThreshold"].includes(key)) await this.recomputeInheritedMarksNow("settings");
		if (key.startsWith("calendarSync")) this.refreshCalendarSyncSchedule();
		this.refreshEpochViews();
	}
};
