import type { EpochPlugin } from "../main";
import { TFile } from "obsidian";
import type { ProcessOptions } from "./indexer-class";
import type { EpochIndex, FileIndexData } from "./types";
import { removeEntriesForFile, sortIndex } from "./indexer-utils";
import { gatherFileEntries } from "./entry-state";
import { markTimelineSearchIndexDirty, scheduleTimelineSearchCacheSave } from "../plugin/timeline-search-cache";
interface FileOpsState {
	files: Record<string, FileIndexData>;
	latestLines: Record<string, string[]>;
	index: EpochIndex;
	plugin: EpochPlugin;
	processFile(file: TFile, options?: ProcessOptions): Promise<void>;
	updateAggregatedEntries(path: string): void;
}
function removeSearch(s: FileOpsState, path: string): void {
	if (s.plugin.timelineSearchIndex?.removeById?.(path)) { markTimelineSearchIndexDirty(s.plugin); scheduleTimelineSearchCacheSave(s.plugin); }
}
export function removeFile(indexer: unknown, path: string): void {
	const s = indexer as FileOpsState;
	removeSearch(s, path);
	delete s.files[path];
	delete s.latestLines[path];
	removeEntriesForFile(s.index, path);
}
export async function renameFile(indexer: unknown, oldPath: string, newPath: string): Promise<void> {
	const s = indexer as FileOpsState;
	if (oldPath === newPath) return;
	removeSearch(s, oldPath);
	const previous = s.files[oldPath];
	if (previous) { for (const entry of gatherFileEntries(previous)) entry.file = newPath; delete s.files[oldPath]; }
	if (s.latestLines[oldPath]) { s.latestLines[newPath] = s.latestLines[oldPath]; delete s.latestLines[oldPath]; }
	removeEntriesForFile(s.index, oldPath);
	const file = s.plugin.app.vault.getAbstractFileByPath(newPath);
	if (file instanceof TFile) await s.processFile(file, { reason: "rename", previous });
	else if (previous) { s.files[newPath] = previous; s.updateAggregatedEntries(newPath); }
	else s.index = sortIndex(s.index);
}
