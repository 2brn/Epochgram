import { normalizePinMode, type DateEntry, type FileDateEntry, type FileIndexData, type SerializedEpochIndex } from "./types";

type DateEntryWithExtras = DateEntry & {
	recurring?: boolean;
};

type AiEntryLike = Record<string, unknown> & {
	aiSummary?: unknown;
	aiSummaryInputHash?: unknown;
};

type FileIndexRecord = FileIndexData & Record<string, unknown>;

function isEpochEntry(entry: { file?: string } | null | undefined): boolean {
	try {
		if (!entry) return false;
		const file = String(entry?.file ?? "");
		return file.startsWith("epoch://");
	} catch {
		return false;
	}
}

function isRecurringSyntheticEntry(entry: DateEntryWithExtras | null | undefined): boolean {
	try {
		return entry?.recurring === true;
	} catch {
		return false;
	}
}

function stripAiFields<T>(entry: T): T {
	if (!entry || typeof entry !== "object") return entry;
	const anyEntry = entry as AiEntryLike;
	if (anyEntry.aiSummary === undefined && anyEntry.aiSummaryInputHash === undefined) return entry;
	const cloned: AiEntryLike = { ...anyEntry };
	try {
		delete cloned.aiSummary;
		delete cloned.aiSummaryInputHash;
	} catch {
		// ignore
	}
	return cloned as T;
}

function copySortedUnknownFields(source: Record<string, unknown>, out: Record<string, unknown>, skipKeys: Set<string>): void {
	try {
		if (!source || typeof source !== "object") return;
		const keys = Object.keys(source)
			.filter(k => !skipKeys.has(k))
			.sort((a, b) => a.localeCompare(b));
		for (const k of keys) {
			out[k] = source[k];
		}
	} catch {
		// ignore
	}
}

export function normalizeSerializedEpochIndexForDisk(serialized: SerializedEpochIndex): SerializedEpochIndex {
	const nextFiles: Record<string, FileIndexData> = {};
	const filePaths = Object.keys(serialized?.files ?? {}).sort((a, b) => a.localeCompare(b));
	for (const path of filePaths) {
		const anyData = serialized.files?.[path] as FileIndexRecord | undefined;
		if (!anyData) continue;
		
		const cdateValue: FileDateEntry | null | undefined = anyData.cdate !== undefined
			? stripAiFields(anyData.cdate)
			: anyData.cdate;
		const namedDateValue: FileDateEntry | null | undefined = anyData.namedDate !== undefined
			? stripAiFields(anyData.namedDate)
			: anyData.namedDate;
		const datePropValue: FileDateEntry | null | undefined = anyData.dateProp !== undefined
			? stripAiFields(anyData.dateProp)
			: anyData.dateProp;
		const contentDatesValue: FileDateEntry[] | undefined = Array.isArray(anyData.contentDates)
			? anyData.contentDates.map((e) => stripAiFields(e))
			: anyData.contentDates;
		
		const trackedDatesValue: Record<string, FileDateEntry[]> = (() => {
			const tracked = anyData.trackedDates ?? {};
			const result: Record<string, FileDateEntry[]> = {};
			for (const date of Object.keys(tracked).sort((a, b) => a.localeCompare(b))) {
				const list = (tracked as Record<string, unknown>)[date];
				result[date] = Array.isArray(list)
					? list.map((e) => stripAiFields(e) as FileDateEntry)
					: [];
			}
			return result;
		})();
		
		const next: FileIndexRecord = {
			cdate: cdateValue,
			namedDate: namedDateValue,
			dateProp: datePropValue,
			contentDates: contentDatesValue,
			trackedDates: trackedDatesValue,
			trackedSnapshot: anyData.trackedSnapshot,
			trackedSnapshotDate: anyData.trackedSnapshotDate,
			trackedBaselineSnapshot: anyData.trackedBaselineSnapshot,
			trackedBaselineDate: anyData.trackedBaselineDate,
			noparsed: anyData.noparsed,
			notracked: anyData.notracked,
			anchorUsesMdate: anyData.anchorUsesMdate,
			indexedMtimeMs: anyData.indexedMtimeMs,
			indexedSize: anyData.indexedSize,
			contentHash: anyData.contentHash,
			embeddingTerm: anyData.embeddingTerm,
			markColor: anyData.markColor,
			markColorHex: anyData.markColorHex,
			pinnedFile: normalizePinMode(anyData.pinnedFile),
			recur: anyData.recur,
			recurHiddenDates: anyData.recurHiddenDates,
			recurReviewedDates: anyData.recurReviewedDates
		};
		
		copySortedUnknownFields(anyData, next, new Set([
			"cdate",
			"namedDate",
			"dateProp",
			"contentDates",
			"trackedDates",
			"trackedSnapshot",
			"trackedSnapshotDate",
			"trackedBaselineSnapshot",
			"trackedBaselineDate",
			"noparsed",
			"notracked",
			"anchorUsesMdate",
			"indexedMtimeMs",
			"indexedSize",
			"contentHash",
			"embeddingTerm",
			"markColor",
			"markColorHex",
			"pinnedFile",
			"recur",
			"recurHiddenDates",
			"recurReviewedDates"
		]));
		nextFiles[path] = next;
	}

	const nextDates: Record<string, DateEntry[]> = {};
	const dateKeys = Object.keys(serialized?.dates ?? {}).sort((a, b) => a.localeCompare(b));
	for (const date of dateKeys) {
		const entries = serialized.dates?.[date];
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const filtered = entries.filter(e => !isEpochEntry(e) && !isRecurringSyntheticEntry(e));
		const cleaned: DateEntry[] = filtered.map(e => stripAiFields(e));
		if (cleaned.length > 0) nextDates[date] = cleaned;
	}

	return {
		files: nextFiles,
		dates: nextDates
	};
}
