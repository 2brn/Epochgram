import { VIEW_TYPE_EPOCH } from "../ui/epoch-view-mode";
import type { EpochPlugin } from "../main";
import type { ResetSelection } from "./maintenance-types";
import { DEFAULT_SETTINGS } from "../settings-model";
import { deleteTimelineSearchCache, bumpTimelineSearchIndexVersion } from "./timeline-search-cache";
export async function runReset(plugin: EpochPlugin, selection: ResetSelection): Promise<void> {
	const runtime = plugin as EpochPlugin & { __epochResetInFlight?: boolean };
	if (runtime.__epochResetInFlight || !selection.settings && !selection.search && !selection.dataFiles && !selection.reviews) return;
	runtime.__epochResetInFlight = true;
	try {
		await plugin.ensureIndexLoaded();
		if (selection.settings) {
			plugin.settings = structuredClone(DEFAULT_SETTINGS);
			plugin.viewPreferences = { showAttachments: false, showParsed: true };
			await plugin.saveSettings(); plugin.refreshCalendarSyncSchedule();
		}
		if (selection.search || selection.dataFiles) {
			await deleteTimelineSearchCache(plugin);
			plugin.timelineSearchIndex.clear(); bumpTimelineSearchIndexVersion(plugin);
			for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH)) {
				const view = leaf.view as unknown as { setSearchQueryInternal?: (query: string) => void };
				view.setSearchQueryInternal?.("");
			}
		}
		if (selection.dataFiles) {
			plugin.clearInheritedMarksCache(); await plugin.clearEpochJsonFilesAndRebuild();
		} else if (selection.settings) await plugin.refreshIndexSmartWithProgress({ suppressNotices: true });
		if (selection.reviews) await plugin.setPathsReview(plugin.indexer.getIndexedPaths(), "draft", false);
		plugin.refreshEpochViews();
	} finally { runtime.__epochResetInFlight = false; }
}
