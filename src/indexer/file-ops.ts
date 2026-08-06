import type { EpochPlugin } from "../main";
import { TFile } from "obsidian";
import type { ProcessOptions } from "./indexer-class";
import type { EpochIndex, FileIndexData } from "./types";
import { removeEntriesForFile, sortIndex } from "./indexer-utils";
import { resolveSummaryForFile } from "./summary-helpers";
import { SUMMARY_ENTRY_SEPARATOR } from "../ui/epoch-canvas-constants";
import { markTimelineSearchIndexDirty, scheduleTimelineSearchCacheSave } from "../plugin/timeline-search-cache";

type SummaryPluginLike = {
	settings?: {
		summaryWordsCount?: number;
	};
};

type FileIndexDataLike = FileIndexData & {
	trackedDates: Record<string, Array<{ file: string; source: string; summary: string } & { date?: string }>>;
};

type FileOpsPluginLike = SummaryPluginLike & {
	app: {
		vault: {
			getAbstractFileByPath(path: string): unknown;
		};
	};
	timelineSearchIndex?: {
		removeById?: (path: string) => boolean;
	};
	enqueueEpochsForDateKeys?: (dates: string[], options: { force: boolean; showNotice: boolean }) => Promise<void> | void;
	enqueueAiSummariesForFile?: (path: string, options: { force: boolean }) => Promise<void> | void;
};

interface FileOpsState {
	files: Record<string, FileIndexData>;
	latestLines: Record<string, string[]>;
	index: EpochIndex;
	plugin: EpochPlugin & FileOpsPluginLike;
	processFile(file: TFile, options?: ProcessOptions): Promise<void>;
	updateAggregatedEntries(filePath: string, options?: { skipSort?: boolean }): void;
}

function state(indexer: unknown): FileOpsState {
	return indexer as FileOpsState;
}

function isDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function collectDates(data: FileIndexDataLike | null | undefined): string[] {
	const out = new Set<string>();
	if (!data) return [];
	const add = (d: unknown) => {
		const v = typeof d === "string" ? d : "";
		if (isDateKey(v)) out.add(v);
	};
	add(data.cdate?.date);
	add(data.namedDate?.date);
	add(data.dateProp?.date);
	for (const e of data.contentDates ?? []) add(e?.date);
	for (const k of Object.keys(data.trackedDates ?? {})) add(k);
	return Array.from(out);
}

function updateFileIndexPath(plugin: SummaryPluginLike, data: FileIndexDataLike, newPath: string): void {
	if (data.cdate) data.cdate.file = newPath;
	if (data.namedDate) data.namedDate.file = newPath;
	if (data.dateProp) data.dateProp.file = newPath;
	for (const entry of data.contentDates) entry.file = newPath;
	for (const dateKey of Object.keys(data.trackedDates)) {
		for (const entry of data.trackedDates[dateKey]) {
			entry.file = newPath;
			if (entry.source === "tracked") {
				const parts = entry.summary.split(SUMMARY_ENTRY_SEPARATOR);
				if (parts.length > 1) {
					const text = parts.slice(1).join(SUMMARY_ENTRY_SEPARATOR);
					entry.summary = resolveSummaryForFile(plugin, newPath, text, { includeFileName: false });
				}
			}
		}
	}
}

export function removeFile(indexer: unknown, path: string): void {
	const s = state(indexer);
	let timelineMutated = false;
	try {
		timelineMutated = s.plugin.timelineSearchIndex?.removeById?.(path) === true;
	} catch {
		// ignore
	}
	if (timelineMutated) {
		try {
			markTimelineSearchIndexDirty(s.plugin);
		} catch {
			// ignore
		}
		try {
			scheduleTimelineSearchCacheSave(s.plugin);
		} catch {
			// ignore
		}
	}

	const previous = s.files[path];
	const affectedDates = collectDates(previous);
	delete s.files[path];
	removeEntriesForFile(s.index, path);
	delete s.latestLines[path];

	if (affectedDates.length > 0 && typeof s.plugin?.enqueueEpochsForDateKeys === "function") {
		try {
			void s.plugin.enqueueEpochsForDateKeys(affectedDates, { force: false, showNotice: false });
		} catch {
			// ignore
		}
	}
}

export async function renameFile(indexer: unknown, oldPath: string, newPath: string): Promise<void> {
	const s = state(indexer);
	if (oldPath === newPath) return;
	let timelineMutated = false;
	try {
		timelineMutated = s.plugin.timelineSearchIndex?.removeById?.(oldPath) === true;
	} catch {
		// ignore
	}
	if (timelineMutated) {
		try {
			markTimelineSearchIndexDirty(s.plugin);
		} catch {
			// ignore
		}
		try {
			scheduleTimelineSearchCacheSave(s.plugin);
		} catch {
			// ignore
		}
	}

	const previous = s.files[oldPath] as FileIndexDataLike | undefined;
	const previousDates = collectDates(previous);
	if (previous) {
		updateFileIndexPath(s.plugin, previous, newPath);
		delete s.files[oldPath];
	}

	if (s.latestLines[oldPath]) {
		s.latestLines[newPath] = s.latestLines[oldPath];
		delete s.latestLines[oldPath];
	}

	removeEntriesForFile(s.index, oldPath);

	const abstract = s.plugin.app.vault.getAbstractFileByPath(newPath);
	if (abstract instanceof TFile) {
		await s.processFile(abstract, {
			reason: "rename",
			skipTrackedUpdate: true,
			previous: previous
		});
		const nextDates = collectDates(s.files[newPath]);
		const touched = Array.from(new Set([...previousDates, ...nextDates]));
		if (touched.length > 0 && typeof s.plugin?.enqueueEpochsForDateKeys === "function") {
			try {
				void s.plugin.enqueueEpochsForDateKeys(touched, { force: false, showNotice: false });
			} catch {
				// ignore
			}
		}
		if (typeof s.plugin?.enqueueAiSummariesForFile === "function") {
			try {
				void s.plugin.enqueueAiSummariesForFile(newPath);
			} catch {
				// ignore
			}
		}
		return;
	}

	if (previous) {
		s.files[newPath] = previous;
		s.updateAggregatedEntries(newPath);
		const nextDates = collectDates(s.files[newPath]);
		const touched = Array.from(new Set([...previousDates, ...nextDates]));
		if (touched.length > 0 && typeof s.plugin?.enqueueEpochsForDateKeys === "function") {
			try {
				void s.plugin.enqueueEpochsForDateKeys(touched, { force: false, showNotice: false });
			} catch {
				// ignore
			}
		}
		if (typeof s.plugin?.enqueueAiSummariesForFile === "function") {
			try {
				void s.plugin.enqueueAiSummariesForFile(newPath);
			} catch {
				// ignore
			}
		}
	} else {
		s.index = sortIndex(s.index);
	}
}
