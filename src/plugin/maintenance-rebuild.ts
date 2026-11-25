import type { EpochPlugin } from "../main";
import type { RebuildSelection } from "./maintenance-types";
export async function runRebuild(plugin: EpochPlugin, selection: RebuildSelection): Promise<void> {
	if (selection.index) await plugin.rebuildIndexWithProgress();
	if (selection.search) await plugin.rebuildTimelineSearchIndex();
}
