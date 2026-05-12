import { normalizePath } from "obsidian";
import type { DateEntry } from "../../indexer/types";
import type { EpochPlugin } from "../../main";
import { isEpochBucket } from "./shared";

type AiSummaryRecord = {
	s: string;
	h: string;
	v: 0 | 1;
};

type EpochSummariesDiskV2 = {
	epochsByDate: Record<string, DateEntry[]>;
	aiSummaries: Record<string, AiSummaryRecord>;
};

function getPath(plugin: EpochPlugin): string {
	const raw = String((plugin as any).epochSummariesFilePath || "");
	return normalizePath(raw);
}

function extractEpochEntriesByDate(plugin: EpochPlugin): Record<string, DateEntry[]> {
	const indexerAny: any = (plugin as any).indexer as any;
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	const out: Record<string, DateEntry[]> = {};
	for (const [date, entries] of Object.entries(index)) {
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const epochs = entries.filter(e => {
			const anyE: any = e as any;
			return String(anyE?.file || "").startsWith("epoch://");
		}) as DateEntry[];
		if (epochs.length > 0) out[date] = epochs;
	}
	return out;
}

function groupTypeForEntry(entry: DateEntry): "anchor" | "content" | "tracked" {
	if (entry.source === "tracked") return "tracked";
	if (entry.source === "cdate" || entry.source === "namedate" || entry.source === "dateprop") return "anchor";
	return "content";
}

function aiSummaryKey(filePath: string, date: string, groupType: "anchor" | "content" | "tracked"): string {
	return `${filePath}|${date}|${groupType}`;
}

function extractAiSummaries(plugin: EpochPlugin): Record<string, AiSummaryRecord> {
	const indexerAny: any = (plugin as any).indexer as any;
	const files: Record<string, any> = indexerAny?.files ?? {};
	const out: Record<string, AiSummaryRecord> = {};

	const record = (entry: any): void => {
		if (!entry) return;
		const filePath = String(entry.file ?? "");
		const date = String(entry.date ?? "");
		if (!filePath || !date) return;
		const s = typeof entry.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const h = typeof entry.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		const v: 0 | 1 = entry.aiSummaryVisible === true ? 1 : 0;
		if (!s || !h) return;
		const gt = groupTypeForEntry(entry as DateEntry);
		out[aiSummaryKey(filePath, date, gt)] = { s, h, v };
	};

	for (const data of Object.values(files)) {
		try {
			record((data as any)?.cdate);
			record((data as any)?.namedDate);
			record((data as any)?.dateProp);
			for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) {
				record(e);
			}
			const tracked = (data as any)?.trackedDates ?? {};
			for (const list of Object.values(tracked)) {
				for (const e of Array.isArray(list) ? list : []) {
					record(e);
				}
			}
		} catch {
			// ignore
		}
	}

	return out;
}

function sanitizeAiSummaries(raw: unknown): Record<string, AiSummaryRecord> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, AiSummaryRecord> = {};
	for (const [k, v] of Object.entries(raw as Record<string, any>)) {
		if (!k) continue;
		if (!v || typeof v !== "object") continue;
		const s = typeof (v as any).s === "string" ? (v as any).s : "";
		const h = typeof (v as any).h === "string" ? (v as any).h : "";
		const vis = (v as any).v;
		if (!s || !h) continue;
		if (vis !== 0 && vis !== 1) continue;
		out[k] = { s, h, v: vis };
	}
	return out;
}

export function applyEpochEntriesByDate(plugin: EpochPlugin, byDate: Record<string, DateEntry[]>): void {
	const indexerAny: any = (plugin as any).indexer as any;
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	for (const [date, incoming] of Object.entries(byDate || {})) {
		const cur = Array.isArray(index[date]) ? index[date] : [];
		const kept = cur.filter(e => {
			const anyE: any = e as any;
			return !String(anyE?.file || "").startsWith("epoch://");
		});
		index[date] = kept.concat(Array.isArray(incoming) ? incoming : []);
	}
}

export function applyAiSummaries(plugin: EpochPlugin, aiSummaries: Record<string, AiSummaryRecord>): void {
	const indexerAny: any = (plugin as any).indexer as any;
	const files: Record<string, any> = indexerAny?.files ?? {};
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	const map = aiSummaries ?? {};

	const applyToEntry = (entry: any): void => {
		if (!entry) return;
		const filePath = String(entry.file ?? "");
		const date = String(entry.date ?? "");
		if (!filePath || !date) return;
		const gt = groupTypeForEntry(entry as DateEntry);
		const rec = map[aiSummaryKey(filePath, date, gt)];
		if (!rec) return;
		(entry as any).aiSummary = rec.s;
		(entry as any).aiSummaryInputHash = rec.h;
		(entry as any).aiSummaryVisible = rec.v === 1;
	};

	for (const data of Object.values(files)) {
		try {
			applyToEntry((data as any)?.cdate);
			applyToEntry((data as any)?.namedDate);
			applyToEntry((data as any)?.dateProp);
			for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) {
				applyToEntry(e);
			}
			const tracked = (data as any)?.trackedDates ?? {};
			for (const list of Object.values(tracked)) {
				for (const e of Array.isArray(list) ? list : []) {
					applyToEntry(e);
				}
			}
		} catch {
			// ignore
		}
	}

	for (const entries of Object.values(index)) {
		if (!Array.isArray(entries)) continue;
		for (const e of entries) {
			const anyE: any = e as any;
			if (String(anyE?.file || "").startsWith("epoch://")) continue;
			applyToEntry(anyE);
		}
	}
}

export async function loadEpochSummariesFromDisk(
	plugin: EpochPlugin
): Promise<{ epochsByDate: Record<string, DateEntry[]>; aiSummaries: Record<string, AiSummaryRecord> }> {
	const p = getPath(plugin);
	if (!p) return { epochsByDate: {}, aiSummaries: {} };
	try {
		const exists = await plugin.app.vault.adapter.exists(p);
		if (!exists) return { epochsByDate: {}, aiSummaries: {} };
		const raw = await plugin.app.vault.adapter.read(p);
		if (!raw) return { epochsByDate: {}, aiSummaries: {} };
		const parsed: any = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { epochsByDate: {}, aiSummaries: {} };
		const epochsByDateRaw = parsed.epochsByDate && typeof parsed.epochsByDate === "object" ? parsed.epochsByDate : {};
		const aiSummaries = sanitizeAiSummaries(parsed.aiSummaries);
		if (!epochsByDateRaw && !aiSummaries) return { epochsByDate: {}, aiSummaries: {} };

		const epochsByDate: Record<string, DateEntry[]> = {};
		for (const [date, entries] of Object.entries(epochsByDateRaw as Record<string, unknown>)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const kept = (entries as any[]).filter((e): boolean => {
				if (!e) return false;
				const anyE: any = e as any;
				const file = String(anyE?.file || "");
				if (!file.startsWith("epoch://")) return false;
				const bucketRaw = String(anyE?.epochBucket || "");
				return bucketRaw.length > 0 && isEpochBucket(bucketRaw);
			}) as DateEntry[];
			if (kept.length > 0) epochsByDate[date] = kept;
		}
		return {
			epochsByDate,
			aiSummaries
		};
	} catch {
		return { epochsByDate: {}, aiSummaries: {} };
	}
}

export async function saveEpochSummariesToDisk(plugin: EpochPlugin): Promise<void> {
	const p = getPath(plugin);
	if (!p) return;
	const payload: EpochSummariesDiskV2 = {
		epochsByDate: extractEpochEntriesByDate(plugin),
		aiSummaries: extractAiSummaries(plugin)
	};
	try {
		const root = p.split("/").slice(0, -1).join("/");
		if (root) {
			await plugin.app.vault.adapter.mkdir(root);
		}
	} catch {
		// ignore
	}
	try {
		await plugin.app.vault.adapter.write(p, JSON.stringify(payload));
	} catch {
		// ignore
	}
}
