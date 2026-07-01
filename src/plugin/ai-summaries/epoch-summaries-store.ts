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

type StoreEntry = Partial<DateEntry> & {
	file?: string;
	date?: string;
	epochBucket?: string;
	aiSummary?: string;
	aiSummaryInputHash?: string;
	aiSummaryVisible?: boolean;
	contentDates?: StoreEntry[];
	trackedDates?: Record<string, StoreEntry[]>;
};

type StoreFileData = {
	cdate?: StoreEntry | null;
	namedDate?: StoreEntry | null;
	dateProp?: StoreEntry | null;
	contentDates?: StoreEntry[];
	trackedDates?: Record<string, StoreEntry[]>;
};

type StoreIndexerLike = {
	index?: Record<string, StoreEntry[]>;
	files?: Record<string, StoreFileData>;
};

type EpochSummariesRuntime = {
	epochSummariesFilePath?: string;
	indexer?: StoreIndexerLike;
};

function getPath(plugin: EpochPlugin): string {
	const runtime = plugin as unknown as EpochSummariesRuntime;
	const raw = String(runtime.epochSummariesFilePath || "");
	return normalizePath(raw);
}

function extractEpochEntriesByDate(plugin: EpochPlugin): Record<string, DateEntry[]> {
	const runtime = plugin as unknown as EpochSummariesRuntime;
	const index = runtime.indexer?.index ?? {};
	const out: Record<string, DateEntry[]> = {};
	for (const [date, entries] of Object.entries(index)) {
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const epochs = entries.filter((e): e is DateEntry => String(e.file || "").startsWith("epoch://"));
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
	const runtime = plugin as unknown as EpochSummariesRuntime;
	const files = runtime.indexer?.files ?? {};
	const out: Record<string, AiSummaryRecord> = {};

	const record = (entry: StoreEntry | null | undefined): void => {
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
			record(data?.cdate);
			record(data?.namedDate);
			record(data?.dateProp);
			for (const e of Array.isArray(data?.contentDates) ? data.contentDates : []) {
				record(e);
			}
			const tracked = data?.trackedDates ?? {};
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
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (!k) continue;
		if (!v || typeof v !== "object") continue;
		const rec = v as { s?: unknown; h?: unknown; v?: unknown };
		const s = typeof rec.s === "string" ? rec.s : "";
		const h = typeof rec.h === "string" ? rec.h : "";
		const vis = rec.v;
		if (!s || !h) continue;
		if (vis !== 0 && vis !== 1) continue;
		out[k] = { s, h, v: vis };
	}
	return out;
}

export function applyEpochEntriesByDate(plugin: EpochPlugin, byDate: Record<string, DateEntry[]>): void {
	const runtime = plugin as unknown as EpochSummariesRuntime;
	const index = runtime.indexer?.index;
	if (!index) return;
	for (const [date, incoming] of Object.entries(byDate || {})) {
		const cur = Array.isArray(index[date]) ? index[date] : [];
		const kept = cur.filter((e) => !String(e.file || "").startsWith("epoch://"));
		index[date] = kept.concat(Array.isArray(incoming) ? incoming : []);
	}
}

export function applyAiSummaries(plugin: EpochPlugin, aiSummaries: Record<string, AiSummaryRecord>): void {
	const runtime = plugin as unknown as EpochSummariesRuntime;
	const files = runtime.indexer?.files ?? {};
	const index = runtime.indexer?.index ?? {};
	const map = aiSummaries ?? {};

	const applyToEntry = (entry: StoreEntry | null | undefined): void => {
		if (!entry) return;
		const filePath = String(entry.file ?? "");
		const date = String(entry.date ?? "");
		if (!filePath || !date) return;
		const gt = groupTypeForEntry(entry as DateEntry);
		const rec = map[aiSummaryKey(filePath, date, gt)];
		if (!rec) return;
		entry.aiSummary = rec.s;
		entry.aiSummaryInputHash = rec.h;
		entry.aiSummaryVisible = rec.v === 1;
	};

	for (const data of Object.values(files)) {
		try {
			applyToEntry(data?.cdate);
			applyToEntry(data?.namedDate);
			applyToEntry(data?.dateProp);
			for (const e of Array.isArray(data?.contentDates) ? data.contentDates : []) {
				applyToEntry(e);
			}
			const tracked = data?.trackedDates ?? {};
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
			if (String(e.file || "").startsWith("epoch://")) continue;
			applyToEntry(e);
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
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { epochsByDate: {}, aiSummaries: {} };
		const parsedObj = parsed as { epochsByDate?: unknown; aiSummaries?: unknown };
		const epochsByDateRaw = parsedObj.epochsByDate && typeof parsedObj.epochsByDate === "object" ? parsedObj.epochsByDate : {};
		const aiSummaries = sanitizeAiSummaries(parsedObj.aiSummaries);
		if (!epochsByDateRaw && !aiSummaries) return { epochsByDate: {}, aiSummaries: {} };

		const epochsByDate: Record<string, DateEntry[]> = {};
		for (const [date, entries] of Object.entries(epochsByDateRaw as Record<string, unknown>)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const kept = entries.filter((e): e is DateEntry => {
				if (!e) return false;
				const entry = e as StoreEntry;
				const file = String(entry.file || "");
				if (!file.startsWith("epoch://")) return false;
				const bucketRaw = String(entry.epochBucket || "");
				return bucketRaw.length > 0 && isEpochBucket(bucketRaw);
			});
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
