import type { EpochPlugin } from "../../main";
import type { DateEntry, EpochBucket } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import type { EpochJobMode } from "./epochs-types";

import { computeAiSummaryInputHash, isLikelyTextFilePath } from "../../utils";
import { isTopicSimilarityEnabled } from "../similarity/config";
import { getAiSummaryTuning } from "./bridge-settings";
import { buildEpochContext } from "./contexts";
import { buildRelatedSummariesForFiles } from "./related";
import {
	EPOCH_BUCKET_ORDER,
	isDateKey,
	isEpochBucket,
	parseDateKey,
	pickEpochPeriod,
	splitIntoAiChunksByLines
} from "./shared";
import { schedulePersist } from "./persistence";
import { formatEpochItemText } from "./epochs/formatting";
import {
	normalizeEpochEntriesInIndex,
	removeEpochEntriesFromIndexByStart,
	truncateOverlappingEpochPeriods
} from "./epochs/index-utils";
import { sortEpochJobsByHierarchy } from "./epochs/job-sort";

type EpochInputRec = {
	day: string;
	sortMs: number;
	file: string;
	seq: number;
	line: string;
	dedupeKey: string;
};

type EpochInputFileStats = {
	records: number;
	markedRecords: number;
	pinnedRecords: number;
	anchorRecords: number;
	newestDayKey: string;
};

function normalizeEpochInputFilePath(rawPath: string): string {
	const raw = String(rawPath || "").trim();
	if (!raw) return "";
	if (raw.startsWith("epoch://")) return raw;
	return raw.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function buildEpochInputText(
	bucket: EpochBucket,
	recs: EpochInputRec[],
	nonTextAttachments: string[] = [],
	options?: {
		statsByFile?: Map<string, EpochInputFileStats>;
		inboundCounts?: Map<string, number>;
		getEpochMaxFileChars?: (bucket: EpochBucket) => number;
		getTopicKeyForFile?: (filePath: string) => string;
		getTagsForFile?: (filePath: string) => string[];
		getDirectoryForFile?: (filePath: string) => string;
	}
): string {
	const groups = new Map<string, { file: string; newestMs: number; byKey: Map<string, EpochInputRec> }>();
	for (const r of recs) {
		const filePath = String(r.file || "").trim();
		if (!filePath) continue;
		let g = groups.get(filePath);
		if (!g) {
			g = { file: filePath, newestMs: r.sortMs, byKey: new Map<string, EpochInputRec>() };
			groups.set(filePath, g);
		}
		if (r.sortMs > g.newestMs) g.newestMs = r.sortMs;
		const prev = g.byKey.get(r.dedupeKey);
		if (!prev || r.sortMs > prev.sortMs) {
			g.byKey.set(r.dedupeKey, r);
		}
	}

	const maxCharsPerFile = options?.getEpochMaxFileChars?.(bucket) ?? 0;

	type FileRank = {
		file: string;
		groupKey: string;
		hasPinned: number;
		marked: number;
		hasTopic: number;
		inbound: number;
		records: number;
		newestDayKey: string;
		newestMs: number;
	};
	const statsByFile = options?.statsByFile;
	const inboundCounts = options?.inboundCounts;
	const getTopicKeyForFile = options?.getTopicKeyForFile;
	const getTagsForFile = options?.getTagsForFile;
	const getDirectoryForFile = options?.getDirectoryForFile;
	const filePaths = Array.from(groups.keys());
	const ranks: FileRank[] = filePaths.map((file) => {
		const g = groups.get(file)!;
		const st = statsByFile?.get(file) ?? { records: 0, markedRecords: 0, pinnedRecords: 0, anchorRecords: 0, newestDayKey: "" };
		const topic = getTopicKeyForFile ? String(getTopicKeyForFile(file) || "") : "";
		const tags = getTagsForFile ? getTagsForFile(file) : [];
		const dir = getDirectoryForFile ? String(getDirectoryForFile(file) || "") : "";
		const groupKey = topic ? `topic:${topic}` : (tags[0] ? `tag:${tags[0]}` : (dir ? `dir:${dir}` : "misc"));
		return {
			file,
			groupKey,
			hasPinned: st.pinnedRecords > 0 ? 1 : 0,
			marked: st.markedRecords,
			hasTopic: topic ? 1 : 0,
			inbound: inboundCounts?.get(file) ?? 0,
			records: st.records,
			newestDayKey: String(st.newestDayKey || ""),
			newestMs: g.newestMs
		};
	});
	const cmpRank = (a: FileRank, b: FileRank): number => {
		if (a.hasPinned !== b.hasPinned) return a.hasPinned > b.hasPinned ? -1 : 1;
		if (a.marked !== b.marked) return a.marked > b.marked ? -1 : 1;
		if (a.hasTopic !== b.hasTopic) return a.hasTopic > b.hasTopic ? -1 : 1;
		if (a.inbound !== b.inbound) return a.inbound > b.inbound ? -1 : 1;
		if (a.records !== b.records) return a.records > b.records ? -1 : 1;
		if (a.newestDayKey !== b.newestDayKey) return a.newestDayKey > b.newestDayKey ? -1 : 1;
		if (a.newestMs !== b.newestMs) return a.newestMs > b.newestMs ? -1 : 1;
		return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
	};
	const byGroup = new Map<string, FileRank[]>();
	for (const r of ranks) {
		const list = byGroup.get(r.groupKey) ?? [];
		list.push(r);
		byGroup.set(r.groupKey, list);
	}
	for (const list of byGroup.values()) list.sort(cmpRank);
	type GroupRank = { key: string; top: FileRank };
	const groupRanks: GroupRank[] = Array.from(byGroup.entries()).map(([key, list]) => ({ key, top: list[0]! }));
	groupRanks.sort((a, b) => {
		const c = cmpRank(a.top, b.top);
		if (c !== 0) return c;
		return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	});
	const orderedFiles: string[] = [];
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const g of groupRanks) {
			const list = byGroup.get(g.key);
			if (!list || list.length === 0) continue;
			const next = list.shift();
			if (!next) continue;
			orderedFiles.push(next.file);
			progressed = true;
		}
	}

	const lines: string[] = [];
	const pushBullet = (raw: string): void => {
		const multi = String(raw ?? "").trim();
		if (!multi) return;
		const parts = multi.split(/\r?\n/g);
		const first = String(parts[0] ?? "").trim();
		if (!first) return;
		lines.push("- " + first);
		for (let i = 1; i < parts.length; i++) {
			const ln = String(parts[i] ?? "").trimEnd();
			lines.push(`  ${ln || "|"}`);
		}
	};
	for (const filePath of orderedFiles) {
		const g = groups.get(filePath);
		if (!g) continue;
		const items = Array.from(g.byKey.values());
		items.sort((a, b) => {
			if (a.sortMs !== b.sortMs) return a.sortMs > b.sortMs ? -1 : 1;
			return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
		});
		if (items.length === 0) continue;
		if (lines.length > 0) lines.push("");
		lines.push(`${g.file}:`);
		let emittedAny = false;
		let charCount = 0;
		for (const it of items) {
			const s = String(it.line || "").trim();
			if (!s) continue;
			const estimate = s.length + 4;
			if (maxCharsPerFile > 0 && emittedAny && (charCount + estimate) > maxCharsPerFile) break;
			pushBullet(s);
			emittedAny = true;
			charCount += estimate;
		}
	}

	const att = Array.isArray(nonTextAttachments)
		? Array.from(new Set(nonTextAttachments.map((p) => String(p || "").trim()).filter(Boolean))).sort()
		: [];
	if (att.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Attachments:");
		for (const p of att) {
			lines.push(`- ${p}`);
		}
	}

	return lines.join("\n").trim();
}

function splitEpochInputIntoChunksPreservingGroups(inputText: string, maxChars: number): string[] {
	const text = String(inputText || "").trim();
	if (!text) return [""];
	const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.max(1, Math.floor(maxChars)) : 1;
	if (text.length <= limit) return [text];

	const blocks = text.split(/\r?\n\s*\r?\n+/g).map((b) => String(b || "").trim()).filter(Boolean);
	if (blocks.length === 0) return splitIntoAiChunksByLines(text, limit);

	const chunks: string[] = [];
	let current = "";
	const pushCurrent = (): void => {
		const c = current.trim();
		if (c) chunks.push(c);
		current = "";
	};

	const appendBlock = (block: string): void => {
		const b = String(block || "").trim();
		if (!b) return;
		if (!current) {
			current = b;
			return;
		}
		const candidate = current + "\n\n" + b;
		if (candidate.length <= limit) {
			current = candidate;
			return;
		}
		pushCurrent();
		current = b;
	};

	for (const block of blocks) {
		const b = String(block || "").trim();
		if (!b) continue;

		// If a single file block is too large, split within it but keep the header line
		// at the top of each sub-chunk so the input remains grouped by note.
		if (b.length > limit) {
			pushCurrent();
			const lines = b.split(/\r?\n/g);
			const header = String(lines[0] ?? "").trim();
			const rest = lines.slice(1).join("\n").trim();
			if (!header || !rest) {
				for (const sub of splitIntoAiChunksByLines(b, limit)) {
					const s = String(sub || "").trim();
					if (s) chunks.push(s);
				}
				continue;
			}
			const headerPrefix = header + "\n";
			const restLimit = Math.max(1, limit - headerPrefix.length);
			for (const sub of splitIntoAiChunksByLines(rest, restLimit)) {
				const s = String(sub || "").trim();
				if (!s) continue;
				chunks.push((headerPrefix + s).trim());
			}
			continue;
		}

		appendBlock(b);
	}
	pushCurrent();

	return chunks.length > 0 ? chunks : [text];
}

export async function buildEpochJobsForDateKeys(
	plugin: EpochPlugin,
	dateKeys: string[],
	mode: EpochJobMode = "staleOrMissing",
	bucketsOverride?: EpochBucket[]
): Promise<AiSummaryJob[]> {
	const tuning = getAiSummaryTuning(plugin);
	const clipRelated = (raw: string): string => {
		const text = String(raw || "").trim();
		if (!text) return "";
		return text.length > tuning.maxRelatedChars ? text.slice(0, tuning.maxRelatedChars) : text;
	};
	const computeInboundCounts = (): Map<string, number> => {
		const out = new Map<string, number>();
		try {
			const mc: any = (plugin as any)?.app?.metadataCache;
			const resolvedLinks: any = mc?.resolvedLinks;
			if (!resolvedLinks || typeof resolvedLinks !== "object") return out;
			for (const src of Object.keys(resolvedLinks)) {
				const outbound = resolvedLinks[src];
				if (!outbound || typeof outbound !== "object") continue;
				for (const dst of Object.keys(outbound)) {
					const rawCount = (outbound as any)[dst];
					const inc = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : 1;
					if (!dst) continue;
					out.set(dst, (out.get(dst) ?? 0) + inc);
				}
			}
		} catch {
			// ignore
		}
		return out;
	};
	const inboundCounts = computeInboundCounts();
	const getDirectoryKey = (filePath: string): string => {
		const p = String(filePath || "").replace(/\\/g, "/");
		const idx = p.lastIndexOf("/");
		if (idx <= 0) return "";
		return p.slice(0, idx);
	};
	const getTopicKeyForFile = (filePath: string): string => {
		try {
			const indexerAny: any = plugin.indexer as any;
			if (typeof indexerAny?.getFileEmbeddingTerm === "function") {
				const t = String(indexerAny.getFileEmbeddingTerm(filePath) || "").trim();
				if (t) return t;
			}
		} catch {
			// ignore
		}
		try {
			if (!isTopicSimilarityEnabled(plugin)) return "";
			const anyPlugin: any = plugin as any;
			const thresholdRaw = Number(anyPlugin?.settings?.similarityZeroShotMinScore ?? 0);
			const threshold = Number.isFinite(thresholdRaw) ? Math.max(0, Math.min(1, thresholdRaw)) : 0;
			const storeLoaded = anyPlugin?.termSimilarityLoaded === true && !!anyPlugin?.termSimilarityIndex;
			if (storeLoaded && threshold > 0 && threshold < 1) {
				const rec: any = anyPlugin?.termSimilarityIndex?.files?.[filePath];
				const inferred = typeof rec?.term === "string" ? String(rec.term).trim() : "";
				const score = Number(rec?.score ?? 0);
				if (inferred && Number.isFinite(score) && score >= threshold) return inferred;
			}
		} catch {
			// ignore
		}
		return "";
	};
	const getTagsForFile = (_filePath: string): string[] => {
		// Tag grouping is best-effort here; avoid heavy vault-wide scans.
		return [];
	};
	const indexerAny: any = plugin.indexer as any;
	const index: Record<string, DateEntry[]> = indexerAny?.index ?? {};
	const files: Record<string, any> = indexerAny?.files ?? {};
	normalizeEpochEntriesInIndex(plugin, index);

	const entriesByDate = new Map<string, any[]>();
	const dateKeySet = new Set<string>();
	const recordEntry = (entry: any): void => {
		if (!entry) return;
		const d = String((entry as any)?.date ?? "");
		if (!isDateKey(d)) return;
		dateKeySet.add(d);
		const list = entriesByDate.get(d) ?? [];
		list.push(entry);
		entriesByDate.set(d, list);
	};
	for (const data of Object.values(files)) {
		try {
			recordEntry((data as any)?.cdate);
			recordEntry((data as any)?.namedDate);
			recordEntry((data as any)?.dateProp);
			for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) recordEntry(e);
			const tracked = (data as any)?.trackedDates ?? {};
			for (const list of Object.values(tracked)) {
				for (const e of Array.isArray(list) ? list : []) recordEntry(e);
			}
		} catch {
		}
	}
	for (const k of Object.keys(index)) {
		if (isDateKey(k)) dateKeySet.add(k);
	}
	for (const k of dateKeys) {
		if (isDateKey(k)) dateKeySet.add(k);
	}
	const allDateKeys = Array.from(dateKeySet.values());
	allDateKeys.sort((a, b) => (a === b ? 0 : a < b ? 1 : -1));

	const isAnchorSource = (src: string): boolean => src === "dateprop" || src === "namedate" || src === "cdate";
	const getAnchorPriority = (src: string): number => (src === "dateprop" ? 3 : src === "namedate" ? 2 : src === "cdate" ? 1 : 0);
	const isSyntheticPinnedTodayClone = (e: any): boolean => {
		try {
			if (!e || e.pinned !== true) return false;
			const date = typeof e.date === "string" ? e.date : "";
			const original = typeof e.originalDate === "string" ? e.originalDate : "";
			return !!original && original !== date;
		} catch {
			return false;
		}
	};

	type PrimaryAnchor = { date: string; priority: number };
	const primaryAnchorByFile = new Map<string, PrimaryAnchor>();
	for (const dayKey of allDateKeys) {
		const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
		const fileEntries = entriesByDate.get(dayKey) ?? [];
		const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
		for (const e of dayEntries) {
			if (!e) continue;
			if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
			if (e?.reviewState === "hidden") continue;
			if (isSyntheticPinnedTodayClone(e as any)) continue;
			if ((e as any)?.recurring === true) continue;
			const rawPath = String((e as any)?.file ?? "");
			const filePath = normalizeEpochInputFilePath(rawPath);
			if (!isLikelyTextFilePath(filePath)) continue;
			const source = String((e as any)?.source ?? "");
			if (!isAnchorSource(source)) continue;
			const date = String((e as any)?.date ?? dayKey);
			if (!isDateKey(date)) continue;
			const priority = getAnchorPriority(source);
			const prev = primaryAnchorByFile.get(filePath);
			if (!prev || priority > prev.priority || (priority === prev.priority && date > prev.date)) {
				primaryAnchorByFile.set(filePath, { date, priority });
			}
		}
	}

	const extractEpochMeta = (e: any): { bucket: EpochBucket; start: string; end: string } | null => {
		try {
			const bucketRaw = String(e?.epochBucket || "");
			const startRaw = String(e?.epochStart || "");
			const endRaw = String(e?.epochEnd || "");
			if (bucketRaw && isEpochBucket(bucketRaw) && isDateKey(startRaw) && isDateKey(endRaw || startRaw)) {
				return { bucket: bucketRaw, start: startRaw, end: endRaw || startRaw };
			}
			return null;
		} catch {
			return null;
		}
	};

	const readEpochText = (e: any): string => String(e?.aiSummary || e?.summary || "").trim();

	const epochByPeriodKey = new Map<string, any>();
	for (const dayKey of allDateKeys) {
		const list = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
		for (const e of list) {
			if (!e) continue;
			const meta = extractEpochMeta(e);
			if (!meta) continue;
			if (meta.start !== dayKey) continue;
			const periodKey = `${meta.bucket}|${meta.start}`;
			const prev = epochByPeriodKey.get(periodKey);
			if (!prev) {
				epochByPeriodKey.set(periodKey, e);
				continue;
			}
			const prevLen = readEpochText(prev).length;
			const nextLen = readEpochText(e).length;
			if (nextLen > prevLen) epochByPeriodKey.set(periodKey, e);
		}
	}

	const touched = Array.from(new Set(dateKeys.filter(isDateKey)));
	if (touched.length === 0) return [];

	const buckets: ReadonlyArray<EpochBucket> =
		Array.isArray(bucketsOverride) && bucketsOverride.length > 0 ? bucketsOverride : EPOCH_BUCKET_ORDER;
	const periods = new Map<string, { bucket: EpochBucket; start: string; end: string }>();
	for (const key of touched) {
		const d = parseDateKey(key);
		if (!d) continue;
		for (const bucket of buckets) {
			const p = pickEpochPeriod(bucket, d);
			const periodKey = `${bucket}|${p.start}`;
			const prev = periods.get(periodKey);
			if (!prev) {
				periods.set(periodKey, { bucket, start: p.start, end: p.end });
			} else if (p.end > prev.end) {
				prev.end = p.end;
			}
		}
	}

	const periodList = truncateOverlappingEpochPeriods(Array.from(periods.values()));

	const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
	const jobs: AiSummaryJob[] = [];
	let pruned = false;

	for (const rec of periodList) {
		const { bucket, start, end } = rec;
		if (!isDateKey(start) || !isDateKey(end)) continue;
		const rangeKeys = allDateKeys.filter((k) => k >= start && k <= end);
		const rangeKeysNewestFirst = rangeKeys.slice().reverse();
		const parseDayKeyUtcMs = (k: string): number => {
			const parts = String(k || "").split("-").map((n) => Number(n));
			if (parts.length !== 3) return 0;
			const [yy, mm, dd] = parts;
			if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return 0;
			return Date.UTC(yy, mm - 1, dd);
		};
		const recs: EpochInputRec[] = [];
		const statsByFile = new Map<string, EpochInputFileStats>();
		const nonTextAttachments = new Set<string>();
		let seq = 0;
		const seenEntryKeys = new Set<string>();
		const entryKeyForDedupe = (
			source: string,
			filePath: string,
			date: string,
			blockStart: number,
			blockEnd: number,
			trackedHash: string
		): string => [source, filePath, date, String(blockStart), String(blockEnd), trackedHash].join("|");
		const anchorSelectionByFile = new Map<string, { key: string; sortIdx: number; priority: number }>();
		for (let idx = 0; idx < rangeKeysNewestFirst.length; idx++) {
			const dayKey = rangeKeysNewestFirst[idx]!;
			const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
			const fileEntries = entriesByDate.get(dayKey) ?? [];
			const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
			const isSyntheticPinnedToday = (e: any): boolean => {
				try {
					if (!e || e.pinned !== true) return false;
					const date = typeof e.date === "string" ? e.date : "";
					const original = typeof e.originalDate === "string" ? e.originalDate : "";
					return !!original && original !== date;
				} catch {
					return false;
				}
			};
			for (const e of dayEntries) {
				if (!e) continue;
				if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
				if (e?.reviewState === "hidden") continue;
				if (isSyntheticPinnedToday(e as any)) continue;
				if ((e as any)?.recurring === true) continue;
				const rawPath = String((e as any)?.file ?? "");
				const filePath = normalizeEpochInputFilePath(rawPath);
				if (!isLikelyTextFilePath(filePath)) continue;
				const source = String((e as any)?.source ?? "");
				if (!isAnchorSource(source)) continue;
				const date = String((e as any)?.date ?? dayKey);
				const primary = primaryAnchorByFile.get(filePath);
				if (primary && date && date !== primary.date) continue;
				const blockStart = Number((e as any)?.blockStart ?? 0);
				const blockEnd = Number((e as any)?.blockEnd ?? blockStart);
				const trackedHash = String((e as any)?.trackedHash ?? "");
				const key = entryKeyForDedupe(source, filePath, date, blockStart, blockEnd, trackedHash);
				const priority = getAnchorPriority(source);
				const prev = anchorSelectionByFile.get(filePath);
				if (!prev) {
					anchorSelectionByFile.set(filePath, { key, sortIdx: idx, priority });
					continue;
				}
				// Prefer anchor kind over recency: if a file has both cdate and dateprop
				// within the period, include only the higher-priority anchor (dateprop).
				if (priority > prev.priority) {
					anchorSelectionByFile.set(filePath, { key, sortIdx: idx, priority });
				} else if (priority === prev.priority && idx < prev.sortIdx) {
					anchorSelectionByFile.set(filePath, { key, sortIdx: idx, priority });
				}
			}
		}
		for (const dayKey of rangeKeysNewestFirst) {
			const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
			const fileEntries = entriesByDate.get(dayKey) ?? [];
			const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
			const isSyntheticPinnedToday = (e: any): boolean => {
				try {
					if (!e || e.pinned !== true) return false;
					const date = typeof e.date === "string" ? e.date : "";
					const original = typeof e.originalDate === "string" ? e.originalDate : "";
					return !!original && original !== date;
				} catch {
					return false;
				}
			};
			const resolveItemText = (e: any): Promise<string> => Promise.resolve(formatEpochItemText(plugin, e));
			for (const e of dayEntries) {
				if (!e) continue;
				if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
				if (e?.reviewState === "hidden") continue;
				if (isSyntheticPinnedToday(e as any)) continue;
				if ((e as any)?.recurring === true) continue;
				const rawPath = String((e as any)?.file ?? "");
				const filePath = normalizeEpochInputFilePath(rawPath);
				if (!isLikelyTextFilePath(filePath)) {
					if (filePath && !filePath.startsWith("epoch://")) nonTextAttachments.add(filePath);
					continue;
				}
				try {
					const src = String((e as any)?.source ?? "");
					if (isAnchorSource(src)) {
						const entryDate = String((e as any)?.date ?? dayKey);
						const primary = primaryAnchorByFile.get(filePath);
						if (primary && entryDate && entryDate !== primary.date) continue;
					}
				} catch {
					// ignore
				}
				const source = String((e as any)?.source ?? "");
				const date = String((e as any)?.date ?? dayKey);
				const day = isDateKey(date) ? date : isDateKey(dayKey) ? dayKey : start;
				const blockStart = Number((e as any)?.blockStart ?? 0);
				const blockEnd = Number((e as any)?.blockEnd ?? blockStart);
				const trackedHash = String((e as any)?.trackedHash ?? "");
				const trackedTimeRaw = String((e as any)?.trackedTime ?? "");
				const key = entryKeyForDedupe(source, filePath, date, blockStart, blockEnd, trackedHash);
				const anchor = anchorSelectionByFile.get(filePath);
				if (anchor && key !== anchor.key) continue;
				if (seenEntryKeys.has(key)) continue;
				seenEntryKeys.add(key);
				const text = await resolveItemText(e as any);
				const textTrimmed = String(text || "").trim();
				if (!textTrimmed) continue;
				const st = statsByFile.get(filePath) ?? { records: 0, markedRecords: 0, pinnedRecords: 0, anchorRecords: 0, newestDayKey: dayKey };
				st.records += 1;
				try {
					if ((e as any)?.pinned === true) st.pinnedRecords += 1;
				} catch {
					// ignore
				}
				try {
					const mc = Number((e as any)?.markColor ?? NaN);
					if (Number.isFinite(mc)) st.markedRecords += 1;
				} catch {
					// ignore
				}
				try {
					const src = String((e as any)?.source ?? "");
					if (isAnchorSource(src)) st.anchorRecords += 1;
				} catch {
					// ignore
				}
				if (!st.newestDayKey || dayKey > st.newestDayKey) st.newestDayKey = dayKey;
				statsByFile.set(filePath, st);
				let sortMs = 0;
				if (trackedTimeRaw) {
					const parsed = Date.parse(trackedTimeRaw);
					if (Number.isFinite(parsed)) sortMs = parsed;
				}
				if (!sortMs) {
					const dayMs = parseDayKeyUtcMs(isDateKey(date) ? date : dayKey);
					sortMs = dayMs;
				}
				const dedupeKey = textTrimmed;
				recs.push({ day, sortMs, file: filePath, seq: seq++, line: textTrimmed, dedupeKey });
			}
		}
		if (recs.length === 0 && bucket === "year") {
			for (const dayKey of rangeKeysNewestFirst) {
				const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
				for (const e of indexEntries) {
					if (!e) continue;
					const epochFilePath = String((e as any)?.file ?? "");
					if (!epochFilePath.startsWith("epoch://")) continue;
					if (e?.reviewState === "hidden") continue;
					const meta = extractEpochMeta(e as any);
					if (!meta) continue;
					if (meta.bucket === "year") continue;
					const text = formatEpochItemText(plugin, { ...(e as any), file: epochFilePath });
					if (!text) continue;
					const sortMs = parseDayKeyUtcMs(meta.start);
					recs.push({ day: meta.start, sortMs, file: epochFilePath, seq: seq++, line: text, dedupeKey: text });
					const st = statsByFile.get(epochFilePath) ?? { records: 0, markedRecords: 0, pinnedRecords: 0, anchorRecords: 0, newestDayKey: meta.start };
					st.records += 1;
					if (!st.newestDayKey || meta.start > st.newestDayKey) st.newestDayKey = meta.start;
					statsByFile.set(epochFilePath, st);
				}
			}
		}
		const inputText = buildEpochInputText(bucket, recs, Array.from(nonTextAttachments), {
			statsByFile,
			inboundCounts,
			getEpochMaxFileChars: (targetBucket) => tuning.getEpochMaxFileChars(targetBucket),
			getTopicKeyForFile,
			getTagsForFile,
			getDirectoryForFile: getDirectoryKey
		});
		const existing = Array.isArray(index[start]) ? index[start]! : [];
		const matchingEpoch =
			epochByPeriodKey.get(`${bucket}|${start}`) ??
			existing.find(
				(e) => e && String((e as any)?.file ?? "").startsWith("epoch://") && e.epochBucket === bucket && e.epochStart === start
			);
		if (!inputText) {
			if (matchingEpoch) {
				pruned = removeEpochEntriesFromIndexByStart(index, bucket, start) || pruned;
			}
			continue;
		}

		const epochFilePath = `epoch://${bucket}/${start}-${end}`;
		const inputHash = computeAiSummaryInputHash(epochFilePath, `${start}|${bucket}`, inputText, tuning.maxChunkChars);
		const related = clipRelated(await buildRelatedSummariesForFiles(plugin, recs.map((rec) => rec.file)));
		const existingText = matchingEpoch ? readEpochText(matchingEpoch as any) : "";
		const existingHash = matchingEpoch ? String((matchingEpoch as any).aiSummaryInputHash || "") : "";
		const isFresh = !!existingText && existingHash === inputHash;

		if (mode === "missing") {
			if (existingText) continue;
		} else if (mode === "staleOrMissing") {
			if (isFresh) continue;
		}

		const chunks = splitEpochInputIntoChunksPreservingGroups(inputText, tuning.maxChunkChars)
			.filter((c) => c && c.trim());
		if (chunks.length === 1) {
			jobs.push({
				id: mkId(),
				filePath: epochFilePath,
				kind: "epoch",
				date: start,
				blockStart: 0,
				blockEnd: 0,
				source: "epoch",
				input: chunks[0]!,
				related,
				context: buildEpochContext(bucket, start, end, related),
				inputHash,
				createdAt: Date.now(),
				epochBucket: bucket,
				epochStart: start,
				epochEnd: end
			});
		} else if (chunks.length > 1) {
			const groupId = mkId();
			for (let i = 0; i < chunks.length; i++) {
				jobs.push({
					id: mkId(),
					reduce: true,
					reduceDepth: 0,
					groupId,
					chunkIndex: i,
					chunkCount: chunks.length,
					filePath: epochFilePath,
					kind: "epoch",
					date: start,
					blockStart: 0,
					blockEnd: 0,
					source: "epoch",
					input: chunks[i]!,
					related,
					context: buildEpochContext(bucket, start, end, related),
					inputHash,
					createdAt: Date.now(),
					epochBucket: bucket,
					epochStart: start,
					epochEnd: end
				});
			}
		}
	}

	if (pruned) {
		schedulePersist(plugin);
	}

	return sortEpochJobsByHierarchy(jobs);
}
