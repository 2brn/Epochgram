import type { EpochSettings } from "../settings";

export interface EpochViewPreferences {
	showDraftsOnly: boolean;
	showAttachments: boolean;
	showTrackedChanges: boolean;
	showParsed: boolean;
	showEpochsView: boolean;
}

export interface PersistedPluginData {
	settings?: Partial<EpochSettings>;
}

export interface FileStatSnapshot {
	mtime: number | null;
	size: number | null;
}
