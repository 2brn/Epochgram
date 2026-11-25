export interface EpochSettings {
	openEpochViewOnStartup: boolean;
	enableAnimation: boolean;
	compactModeMinWidthPercent: number;
	searchResultsLimit: number;
	anchorMdate?: boolean;
	timelineFilters?: { showAttachments?: boolean; showParsed?: boolean };
	parseDatesInFrontmatter?: boolean;
	yamlDateProperty: string;
	yamlDescriptionProperty: string;
	filenameWordsCount: number;
	summaryWordsCount: number;
	calendarSyncIcsUrls?: string[];
	calendarSyncPeriod?: "manual" | "startup" | "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
	calendarSyncFolder?: string;
	calendarSyncTemplatePath?: string;
	similarityUseLinks?: boolean;
	similarityUseTags?: boolean;
	similarityTitleJwThreshold?: number;
	whatsNewShownVersions?: string[];
	whatsNewOptOut?: boolean;
}

export const DEFAULT_SETTINGS: EpochSettings = {
	openEpochViewOnStartup: true,
	enableAnimation: true,
	compactModeMinWidthPercent: 30,
	searchResultsLimit: 7,
	anchorMdate: true,
	timelineFilters: { showAttachments: false, showParsed: true },
	parseDatesInFrontmatter: false,
	yamlDateProperty: "date",
	yamlDescriptionProperty: "description",
	filenameWordsCount: 2,
	summaryWordsCount: 5,
	calendarSyncIcsUrls: [],
	calendarSyncPeriod: "manual",
	calendarSyncFolder: "",
	calendarSyncTemplatePath: "",
	similarityUseLinks: true,
	similarityUseTags: true,
	similarityTitleJwThreshold: 1,
	whatsNewShownVersions: [],
	whatsNewOptOut: false
};
