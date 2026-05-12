import type { DateEntry, SerializedEpochIndex } from "./types";

function isEpochEntry(entry: any): boolean {
	try {
		if (!entry) return false;
		const file = String(entry?.file ?? "");
		return file.startsWith("epoch://");
	} catch {
		return false;
	}
}

function isRecurringSyntheticEntry(entry: any): boolean {
	try {
		return (entry as any)?.recurring === true;
	} catch {
		return false;
	}
}

function stripAiFields<T>(entry: T): T {
	if (!entry || typeof entry !== "object") return entry;
	const anyEntry: any = entry as any;
	if (anyEntry.aiSummary === undefined && anyEntry.aiSummaryInputHash === undefined) return entry;
	const cloned: any = { ...anyEntry };
	try {
		delete cloned.aiSummary;
		delete cloned.aiSummaryInputHash;
	} catch {
		// ignore
	}
	return cloned as T;
}

function copySortedUnknownFields(source: any, out: any, skipKeys: Set<string>): void {
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
	const nextFiles: Record<string, any> = {};
	const filePaths = Object.keys(serialized?.files ?? {}).sort((a, b) => a.localeCompare(b));
	for (const path of filePaths) {
		const anyData: any = (serialized as any)?.files?.[path] as any;
		const cdate = anyData?.cdate ? stripAiFields(anyData.cdate) : anyData?.cdate;
		const namedDate = anyData?.namedDate ? stripAiFields(anyData.namedDate) : anyData?.namedDate;
		const dateProp = anyData?.dateProp ? stripAiFields(anyData.dateProp) : anyData?.dateProp;
		const contentDates = Array.isArray(anyData?.contentDates)
			? anyData.contentDates.map((e: any) => stripAiFields(e))
			: anyData?.contentDates;
		const tracked = anyData?.trackedDates ?? {};
		const nextTracked: Record<string, any[]> = {};
		for (const date of Object.keys(tracked).sort((a, b) => a.localeCompare(b))) {
			const list = (tracked as any)?.[date];
			nextTracked[date] = Array.isArray(list) ? (list as any[]).map((e: any) => stripAiFields(e)) : [];
		}

		// Build in a stable key order to avoid JSON flapping due to insertion-order differences.
		const next: any = {
			cdate,
			namedDate,
			dateProp,
			contentDates,
			trackedDates: nextTracked
		};
		copySortedUnknownFields(anyData, next, new Set(["cdate", "namedDate", "dateProp", "contentDates", "trackedDates", "indexedMtimeMs", "indexedSize", "__pendingTrackedReviewStateClear"]));
		nextFiles[path] = next;
	}

	const nextDates: Record<string, DateEntry[]> = {};
	const dateKeys = Object.keys(serialized?.dates ?? {}).sort((a, b) => a.localeCompare(b));
	for (const date of dateKeys) {
		const entries = (serialized as any)?.dates?.[date];
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const cleaned = (entries as any[])
			.filter(e => !isEpochEntry(e) && !isRecurringSyntheticEntry(e))
			.map(e => stripAiFields(e)) as DateEntry[];
		if (cleaned.length > 0) nextDates[date] = cleaned;
	}

	return {
		files: nextFiles,
		dates: nextDates
	};
}
