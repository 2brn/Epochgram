import type { EpochPlugin } from "../../main";
import type { FileDateEntry, FileIndexData } from "../../indexer/types";
import { isLikelyTextFilePath } from "../../utils";
import { getIndexerInternals } from "./indexer";
import { hasSimilarityAccess } from "../pro-feature-state";

type RelatedScored = Array<{ path: string; score: number }>;

function redactDatesFromPromptText(text: string): string {
	const raw = String(text ?? "");
	if (!raw) return "";
	return raw
		.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
		.replace(/\b\d{4}\/\d{2}\/\d{2}\b/g, "[date]")
		.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[date]")
		.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "[timestamp]");
}

function pickEntrySummary(entry: FileDateEntry | null): string {
	if (!entry) return "";
	const ai = typeof entry.aiSummary === "string" ? String(entry.aiSummary).trim() : "";
	if (ai) return ai;
	const s = typeof entry.summary === "string" ? String(entry.summary).trim() : "";
	return s;
}

function entriesForAllDates(data: FileIndexData): FileDateEntry[] {
	const out: FileDateEntry[] = [];
	if (!data) return out;
	if (data.cdate) out.push(data.cdate);
	if (data.namedDate) out.push(data.namedDate);
	if (data.dateProp) out.push(data.dateProp);
	for (const e of data.contentDates ?? []) {
		if (e) out.push(e);
	}
	for (const list of Object.values(data.trackedDates ?? {})) {
		if (!Array.isArray(list)) continue;
		for (const e of list) {
			if (e) out.push(e);
		}
	}
	return out;
}

function clipText(text: string, maxChars: number): string {
	const t = String(text || "").trim();
	if (!t) return "";
	if (t.length <= maxChars) return t;
	return t.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function entryTimeMsNewestFirst(entry: FileDateEntry): number {
	try {
		const raw = typeof entry.trackedTime === "string" ? String(entry.trackedTime) : "";
		if (!raw) return 0;
		const ms = Date.parse(raw);
		return Number.isFinite(ms) ? ms : 0;
	} catch {
		return 0;
	}
}

function dateKeyTimeMs(dateKey: string): number {
	try {
		const raw = String(dateKey || "").trim();
		if (!raw) return 0;
		// Treat date keys as UTC for deterministic ordering.
		const ms = Date.parse(raw + "T00:00:00Z");
		return Number.isFinite(ms) ? ms : 0;
	} catch {
		return 0;
	}
}

function entrySortMs(entry: FileDateEntry): number {
	const tracked = entryTimeMsNewestFirst(entry);
	if (tracked) return tracked;
	return dateKeyTimeMs(entry?.date ?? "");
}

export async function getRelatedScoredForFile(plugin: EpochPlugin, filePath: string): Promise<RelatedScored> {
	if (!hasSimilarityAccess(plugin)) return [];
	if (!filePath) return [];
	try {
		if (typeof plugin.getSemanticRelatedScoredForFile !== "function") return [];
		const scored = await plugin.getSemanticRelatedScoredForFile(filePath);
		if (!Array.isArray(scored)) return [];
		return scored
			.filter(it => it && typeof it.path === "string" && isLikelyTextFilePath(it.path))
			.map(it => ({ path: it.path, score: typeof it.score === "number" ? it.score : 0 }));
	} catch {
		return [];
	}
}

export function buildRelatedSummariesAllDates(
	plugin: EpochPlugin,
	relatedScored: RelatedScored,
	options: { maxFiles?: number; maxEntriesPerFile?: number; maxSummaryChars?: number; maxTotalChars?: number } = {}
): string {
	const internals = getIndexerInternals(plugin);
	if (!internals) return "";

	const maxFiles = typeof options.maxFiles === "number" ? options.maxFiles : 8;
	const maxEntriesPerFile = typeof options.maxEntriesPerFile === "number" ? options.maxEntriesPerFile : 6;
	const maxSummaryChars = typeof options.maxSummaryChars === "number" ? options.maxSummaryChars : 350;
	const maxTotalChars = typeof options.maxTotalChars === "number" ? options.maxTotalChars : 3500;

	const picked = relatedScored.slice(0, Math.max(0, maxFiles));
	const groups = new Map<
		string,
		{ file: string; newestMs: number; byKey: Map<string, { sortMs: number; seq: number; text: string }> }
	>();
	let seq = 0;

	for (const it of picked) {
		const p = typeof it?.path === "string" ? it.path : "";
		if (!p) continue;
		if (!isLikelyTextFilePath(p)) continue;
		const data = internals.files[p];
		if (!data) continue;
		const entries = entriesForAllDates(data);
		if (entries.length === 0) continue;
		for (const e of entries) {
			const summary = pickEntrySummary(e);
			if (!summary) continue;
			const clipped = redactDatesFromPromptText(clipText(summary, maxSummaryChars));
			if (!clipped.trim()) continue;
			const sortMs = entrySortMs(e);

			let g = groups.get(p);
			if (!g) {
				g = { file: p, newestMs: sortMs, byKey: new Map() };
				groups.set(p, g);
			}
			if (sortMs > g.newestMs) g.newestMs = sortMs;

			const dedupeKey = `${String(e.source ?? "")}|${String(e.date ?? "")}|${String(e.blockStart ?? 0)}|${clipped}`;
			const prev = g.byKey.get(dedupeKey);
			if (!prev || sortMs > prev.sortMs) {
				g.byKey.set(dedupeKey, { sortMs, seq: seq++, text: clipped });
			}
		}
	}

	const groupList = Array.from(groups.values());
	groupList.sort((a, b) => {
		if (a.newestMs !== b.newestMs) return a.newestMs > b.newestMs ? -1 : 1;
		if (a.file !== b.file) return a.file < b.file ? -1 : 1;
		return 0;
	});

	const outLines: string[] = [];
	let totalChars = 0;
	for (const g of groupList) {
		const items = Array.from(g.byKey.values());
		items.sort((a, b) => {
			if (a.sortMs !== b.sortMs) return a.sortMs > b.sortMs ? -1 : 1;
			return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
		});
		const capped = items.slice(0, Math.max(0, maxEntriesPerFile));
		if (capped.length === 0) continue;

		const blockLines: string[] = [];
		blockLines.push(`  - ${g.file}:`);
		for (const it of capped) {
			const s = String(it.text || "").trim();
			if (!s) continue;
			blockLines.push("    - " + s);
		}
		if (blockLines.length <= 1) continue;

		const block = (outLines.length > 0 ? "\n" : "") + blockLines.join("\n");
		if (totalChars + block.length > maxTotalChars) break;
		outLines.push(...blockLines);
		totalChars += block.length;
	}

	const out = outLines.join("\n").trimEnd();
	if (!out) return "";
	return out.length > maxTotalChars ? out.slice(0, maxTotalChars).trimEnd() + "…" : out;
}

export async function buildRelatedSummariesForFiles(
	plugin: EpochPlugin,
	filePaths: string[],
	options: { maxSourceFiles?: number; maxFiles?: number; maxEntriesPerFile?: number; maxSummaryChars?: number; maxTotalChars?: number } = {}
): Promise<string> {
	const normalizedSources = Array.from(new Set(
		(filePaths ?? [])
			.map((filePath) => String(filePath || "").trim())
			.filter((filePath) => !!filePath && isLikelyTextFilePath(filePath) && !filePath.startsWith("epoch://"))
	));
	if (normalizedSources.length === 0) return "";

	const sourceSet = new Set(normalizedSources);
	const maxSourceFiles = typeof options.maxSourceFiles === "number" ? options.maxSourceFiles : 8;
	const pickedSources = normalizedSources.slice(0, Math.max(0, maxSourceFiles));
	const merged = new Map<string, number>();

	for (const filePath of pickedSources) {
		const scored = await getRelatedScoredForFile(plugin, filePath);
		for (const item of scored) {
			const relatedPath = String(item?.path || "").trim();
			if (!relatedPath || sourceSet.has(relatedPath) || !isLikelyTextFilePath(relatedPath)) continue;
			const score = typeof item?.score === "number" ? item.score : 0;
			const prev = merged.get(relatedPath);
			if (prev == null || score > prev) {
				merged.set(relatedPath, score);
			}
		}
	}

	const relatedScored = Array.from(merged.entries())
		.map(([path, score]) => ({ path, score }))
		.sort((a, b) => {
			if (a.score !== b.score) return a.score > b.score ? -1 : 1;
			return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
		});
	if (relatedScored.length === 0) return "";

	return buildRelatedSummariesAllDates(plugin, relatedScored, {
		maxFiles: options.maxFiles,
		maxEntriesPerFile: options.maxEntriesPerFile,
		maxSummaryChars: options.maxSummaryChars,
		maxTotalChars: options.maxTotalChars
	});
}
