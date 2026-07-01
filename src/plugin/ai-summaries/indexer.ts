import type { EpochPlugin } from "../../main";
import type { FileDateEntry, FileIndexData } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";

type IndexerInternalsLike = {
	files?: Record<string, FileIndexData>;
	latestLines?: Record<string, string[]>;
};

export function getIndexerInternals(plugin: EpochPlugin): { files: Record<string, FileIndexData>; latestLines: Record<string, string[]> } | null {
	const indexerState = plugin.indexer as unknown as IndexerInternalsLike;
	const files: Record<string, FileIndexData> | undefined = indexerState?.files;
	const latestLines: Record<string, string[]> | undefined = indexerState?.latestLines;
	if (!files) return null;
	return { files, latestLines: latestLines ?? {} };
}

export async function getLinesForFile(plugin: EpochPlugin, filePath: string): Promise<string[]> {
	try {
		const raw = await plugin.app.vault.adapter.read(filePath);
		const lines = raw.split(/\r?\n/);
		return lines;
	} catch {
		return [];
	}
}

export function findEntryForJob(data: FileIndexData, job: AiSummaryJob): FileDateEntry | null {
	if (job.kind === "cdate") return data.cdate ?? null;
	if (job.kind === "namedDate") return data.namedDate ?? null;
	if (job.kind === "dateProp") return data.dateProp ?? null;

	const list = job.kind === "tracked"
		? Object.values(data.trackedDates ?? {}).flat()
		: (data.contentDates ?? []);
	for (const e of list) {
		if (!e) continue;
		if (e.date !== job.date) continue;
		if (e.blockStart !== job.blockStart) continue;
		if (e.blockEnd !== job.blockEnd) continue;
		if ((e.source ?? "") !== (job.source ?? "")) continue;
		return e;
	}
	return null;
}

export function resolveTargetEntries(data: FileIndexData, job: AiSummaryJob): FileDateEntry[] {
	const out: FileDateEntry[] = [];
	const targets = Array.isArray(job.targets) ? job.targets : null;
	if (!targets || targets.length === 0) {
		const single = findEntryForJob(data, job);
		return single ? [single] : [];
	}
	for (const t of targets) {
		if (!t) continue;
		if (t.kind === "cdate") {
			const e = data.cdate;
			if (e && e.date === t.date) out.push(e);
			continue;
		}
		if (t.kind === "namedDate") {
			const e = data.namedDate;
			if (e && e.date === t.date) out.push(e);
			continue;
		}
		if (t.kind === "dateProp") {
			const e = data.dateProp;
			if (e && e.date === t.date) out.push(e);
			continue;
		}
		const list = t.kind === "tracked"
			? Object.values(data.trackedDates ?? {}).flat()
			: (data.contentDates ?? []);
		for (const e of list) {
			if (!e) continue;
			if (e.date !== t.date) continue;
			if (e.blockStart !== t.blockStart) continue;
			if (e.blockEnd !== t.blockEnd) continue;
			if ((e.source ?? "") !== (t.source ?? "")) continue;
			out.push(e);
			break;
		}
	}
	return out;
}
