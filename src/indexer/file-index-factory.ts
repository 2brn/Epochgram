import type { FileDateEntry, FileIndexData } from "./types";

export function createEmptyFileIndex(): FileIndexData {
	return {
		cdate: null,
		namedDate: null,
		dateProp: null,
		contentDates: [],
		noparsed: false,
		trackedDates: {},
		notracked: false,
		trackedSnapshot: null,
		trackedSnapshotDate: null,
		trackedBaselineSnapshot: null,
		trackedBaselineDate: null,
		recur: null,
		recurHiddenDates: [],
		markColor: undefined,
		pinnedFile: false,
	};
}

export function cloneTrackedDates(source?: Record<string, FileDateEntry[]>): Record<string, FileDateEntry[]> {
	if (!source) return {};
	const clone: Record<string, FileDateEntry[]> = {};
	for (const key of Object.keys(source)) {
		clone[key] = source[key].map(entry => ({ ...entry }));
	}
	return clone;
}
