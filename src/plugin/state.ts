export interface EpochViewPreferences {
	showAttachments: boolean;
	showParsed: boolean;
	showDraftsOnly?: boolean;
}

export interface PersistedPluginData {
	settings?: unknown;
}

export interface FileStatSnapshot {
	mtime: number | null;
	size: number | null;
}
