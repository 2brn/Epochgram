import {
	Plugin,
	WorkspaceLeaf,
	EventRef
} from "obsidian";
import type { EpochSettings } from "./settings";
import { Indexer } from "./indexer/indexer";
import { DEFAULT_SETTINGS } from "./settings";
import type { EpochViewPreferences, FileStatSnapshot } from "./plugin/state";
import { iconMethods, type IconMethods } from "./plugin/icons";
import { dailyNoteMethods, type DailyNoteMethods } from "./plugin/daily-notes";
import { viewMethods, type ViewMethods } from "./plugin/view";
import { lifecycleMethods } from "./plugin/lifecycle";
import { indexingMethods, type IndexingMethods } from "./plugin/indexing";
import { exclusionMethods, type ExclusionMethods } from "./plugin/exclusions";
import { persistenceMethods, type PersistenceMethods } from "./plugin/persistence";
import { fileFlagMethods, type FileFlagMethods } from "./plugin/file-flags";
import { fileEventMethods, type FileEventMethods } from "./plugin/file-events";
import { settingsHandlerMethods, type SettingsHandlerMethods } from "./plugin/settings-handler";
import { pollingMethods, type PollingMethods } from "./plugin/polling";
import { similarityMethods, type SimilarityMethods } from "./plugin/similarity";
import { inheritedMarkMethods, type InheritedMarkMethods } from "./plugin/inherited-marks";
import { searchMethods, type SearchMethods } from "./plugin/search";
import { TimelineSearchIndex } from "./search/timeline-search-index";
import { dateFrontmatterMethods, type DateFrontmatterMethods } from "./plugin/date-frontmatter";
import { descriptionFrontmatterMethods, type DescriptionFrontmatterMethods } from "./plugin/description-frontmatter";
import { calendarSyncMethods, type CalendarSyncMethods } from "./plugin/calendar-sync";
import { reviewMethods, type ReviewMethods } from "./plugin/reviews";

class EpochPluginImpl extends Plugin {
	settings: EpochSettings = { ...DEFAULT_SETTINGS };
	indexer: Indexer = new Indexer(this);
	timelineSearchIndex: TimelineSearchIndex = new TimelineSearchIndex();
	noteLeaf: WorkspaceLeaf | null = null;
	viewPreferences: EpochViewPreferences = {
		showAttachments: false,
		showParsed: true
	};
	pluginDirPath = "";
	indexFilePath = "";
	dataFilePath = "";
	pluginDirEnsured = false;
	indexLoadPromise: Promise<void> | null = null;
	indexReady = false;
	indexFileStat: FileStatSnapshot = { mtime: null, size: null };
	dataFileStat: FileStatSnapshot = { mtime: null, size: null };
	lastIndexContentCheckAt = 0;
	lastDataSignature: string | null = null;
	lastDataSignatureCheck = 0;
	indexPollInFlight = false;
	vaultEventRefs: EventRef[] = [];
	workspaceEventRefs: EventRef[] = [];
	metadataEventRefs: EventRef[] = [];
	excludedFiltersInitialized = false;
	excludedFiltersSignature: string | null = null;
	excludedFilterMatchers: RegExp[] = [];
	excludedSyncInFlight: Promise<void> | null = null;
	lastRebuildNoticeAt = 0;
	// Inherited marks (precomputed)
	__epochInheritedMarkIndexByPath: Map<string, number> | null = null;
	__epochInheritedMarkSourceByPath: Map<string, string> | null = null;
	__epochInheritedMarkReasonByPath: Map<string, string> | null = null;
	__epochInheritedMarkRecomputeTimer: number | null = null;
	__epochInheritedMarkComputedAt = 0;
}

export type EpochPlugin = EpochPluginImpl &
	IconMethods &
	DailyNoteMethods &
	ViewMethods &
	IndexingMethods &
	ExclusionMethods &
	PersistenceMethods &
	FileFlagMethods &
	FileEventMethods &
	SettingsHandlerMethods &
	PollingMethods &
	SimilarityMethods &
	InheritedMarkMethods &
	SearchMethods &
	DateFrontmatterMethods &
	DescriptionFrontmatterMethods &
	CalendarSyncMethods &
	ReviewMethods;

Object.assign(
   EpochPluginImpl.prototype,
   iconMethods,
   dailyNoteMethods,
   viewMethods,
   indexingMethods,
   exclusionMethods,
   persistenceMethods,
   fileFlagMethods,
   fileEventMethods,
   settingsHandlerMethods,
   pollingMethods,
   similarityMethods,
   inheritedMarkMethods,
   searchMethods,
   dateFrontmatterMethods,
	descriptionFrontmatterMethods,
	calendarSyncMethods,
	reviewMethods,
   lifecycleMethods
);

export default EpochPluginImpl;
