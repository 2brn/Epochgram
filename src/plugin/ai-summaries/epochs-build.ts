import type { EpochPlugin } from "../../main";
import type { DateEntry, EpochBucket } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import type { EpochJobMode } from "./epochs-types";

import { computeAiSummaryInputHash } from "../../utils";
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
import { normalizeEpochEntriesInIndex, removeEpochEntriesFromIndexByStart } from "./epochs/index-utils";
import { sortEpochJobsByHierarchy } from "./epochs/job-sort";

export async function buildEpochJobs(plugin: EpochPlugin, mode: EpochJobMode = "staleOrMissing"): Promise<AiSummaryJob[]> {
	const INVISIBLE_FORMAT_CHARS_RE = /\u00AD|\u034F|\u061C|\u180E|[\u200B-\u200F]|[\u202A-\u202E]|[\u2060-\u206F]|\uFEFF/g;
	const normalizeEpochInputFilePath = (rawPath: string): string => {
		const raw = String(rawPath || "").trim();
		if (!raw) return "";
		if (raw.startsWith("epoch://")) return raw;
		return raw.replace(/\\/g, "/").replace(/\/+/g, "/");
	};
	const normalizeLineKey = (line: string): string => {
		try {
			return String(line ?? "")
				.normalize("NFKC")
				.replace(INVISIBLE_FORMAT_CHARS_RE, "")
				.replace(/[“”]/g, '"')
				.replace(/[‘’]/g, "'")
				.replace(/\s+/g, " ")
				.trim();
		} catch {
			return String(line ?? "").trim();
		}
	};
	const isSyntheticPinnedTodayClone = (entry: any): boolean => {
		try {
			if (!entry || entry.pinned !== true) return false;
			const originalDate = String(entry.originalDate ?? "").trim();
			const date = String(entry.date ?? "").trim();
			return !!originalDate && !!date && originalDate !== date;
		} catch {
			return false;
		}
	};
	const isRecurringSyntheticEntry = (entry: any): boolean => {
		try {
			return (entry as any)?.recurring === true;
		} catch {
			return false;
		}
	};
	const isAnchorSource = (src: string): boolean => src === "dateprop" || src === "namedate" || src === "cdate";
	const getAnchorPriority = (src: string): number => (src === "dateprop" ? 3 : src === "namedate" ? 2 : src === "cdate" ? 1 : 0);
	const tuning = getAiSummaryTuning(plugin);
	const clipRelated = (raw: string): string => {
		const text = String(raw || "").trim();
		if (!text) return "";
		return text.length > tuning.maxRelatedChars ? text.slice(0, tuning.maxRelatedChars) : text;
	};
	type EpochInputFileStats = {
		records: number;
		markedRecords: number;
		pinnedRecords: number;
		anchorRecords: number;
		newestDayKey: string;
	};
	const getPerFileCharCapForBucket = (bucket: EpochBucket): number => {
		return tuning.getEpochMaxFileChars(bucket);
	};
	const getInboundLinkCountIndex = (): Map<string, number> => {
		const out = new Map<string, number>();
		try {
			const mc: any = (plugin.app as any)?.metadataCache;
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
	const collectNormalizedTagsForPath = (filePath: string): string[] => {
		const out = new Set<string>();
		const normalizeTag = (tag: string): string => {
			const t = String(tag || "").trim().toLowerCase();
			if (!t) return "";
			return t.startsWith("#") ? t.slice(1) : t;
		};
		try {
			const appAny: any = plugin.app as any;
			const mc: any = appAny?.metadataCache;
			const abs: any = appAny?.vault?.getAbstractFileByPath?.(filePath);
			const cache = mc?.getFileCache?.(abs);
			const tags = cache?.tags;
			if (Array.isArray(tags)) {
				for (const t of tags) {
					const norm = normalizeTag((t as any)?.tag ?? t);
					if (norm) out.add(norm);
				}
			}
			const fmTags = cache?.frontmatter?.tags;
			if (typeof fmTags === "string") {
				for (const seg of fmTags.split(/[\s,]+/g)) {
					const norm = normalizeTag(seg);
					if (norm) out.add(norm);
				}
			} else if (Array.isArray(fmTags)) {
				for (const seg of fmTags) {
					const norm = normalizeTag(seg);
					if (norm) out.add(norm);
				}
			}
		} catch {
			// ignore
		}
		return Array.from(out.values()).sort();
	};
	const getDirectoryKey = (filePath: string): string => {
		const p = String(filePath || "").replace(/\\/g, "/");
		const idx = p.lastIndexOf("/");
		if (idx <= 0) return "";
		return p.slice(0, idx);
	};
	const pickTopicKeyForFile = (filePath: string): string => {
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
	const buildOrderedFileListForIntent = (
		bucket: EpochBucket,
		groups: Map<string, string[]>,
		statsByFile: Map<string, EpochInputFileStats>,
		inboundCounts: Map<string, number>
	): string[] => {
		const filePaths = Array.from(groups.keys());
		if (filePaths.length <= 1) return filePaths;

		type FileRank = {
			file: string;
			groupKey: string;
			hasPinned: number;
			marked: number;
			hasTopic: number;
			inbound: number;
			records: number;
			newestDayKey: string;
		};
		const ranks: FileRank[] = [];
		for (const file of filePaths) {
			const st = statsByFile.get(file) ?? { records: 0, markedRecords: 0, pinnedRecords: 0, anchorRecords: 0, newestDayKey: "" };
			const topic = pickTopicKeyForFile(file);
			const tags = collectNormalizedTagsForPath(file);
			const dir = getDirectoryKey(file);
			const groupKey = topic ? `topic:${topic}` : (tags[0] ? `tag:${tags[0]}` : (dir ? `dir:${dir}` : "misc"));
			ranks.push({
				file,
				groupKey,
				hasPinned: st.pinnedRecords > 0 ? 1 : 0,
				marked: st.markedRecords,
				hasTopic: topic ? 1 : 0,
				inbound: inboundCounts.get(file) ?? 0,
				records: st.records,
				newestDayKey: String(st.newestDayKey || "")
			});
		}

		const cmpRank = (a: FileRank, b: FileRank): number => {
			if (a.hasPinned !== b.hasPinned) return a.hasPinned > b.hasPinned ? -1 : 1;
			if (a.marked !== b.marked) return a.marked > b.marked ? -1 : 1;
			if (a.hasTopic !== b.hasTopic) return a.hasTopic > b.hasTopic ? -1 : 1;
			if (a.inbound !== b.inbound) return a.inbound > b.inbound ? -1 : 1;
			if (a.records !== b.records) return a.records > b.records ? -1 : 1;
			if (a.newestDayKey !== b.newestDayKey) return a.newestDayKey > b.newestDayKey ? -1 : 1;
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

		const ordered: string[] = [];
		let progressed = true;
		while (progressed) {
			progressed = false;
			for (const g of groupRanks) {
				const list = byGroup.get(g.key);
				if (!list || list.length === 0) continue;
				const next = list.shift();
				if (!next) continue;
				ordered.push(next.file);
				progressed = true;
			}
		}
		return ordered;
	};
	const buildGroupedEpochInputText = (
		groups: Map<string, string[]>,
		options?: { orderedFiles?: string[]; maxCharsPerFile?: number }
	): string => {
		const parts: string[] = [];
		const pushBullet = (raw: string): void => {
			const multi = String(raw ?? "").trim();
			if (!multi) return;
			const lines = multi.split(/\r?\n/g);
			const first = String(lines[0] ?? "").trim();
			if (!first) return;
			parts.push(`- ${first}`);
			for (let i = 1; i < lines.length; i++) {
				const ln = String(lines[i] ?? "").trimEnd();
				parts.push(`  ${ln || "|"}`);
			}
		};
		const orderedFiles = Array.isArray(options?.orderedFiles) ? options?.orderedFiles : null;
		const ordered = orderedFiles && orderedFiles.length > 0 ? orderedFiles : Array.from(groups.keys());
		const maxCharsPerFile =
			options && typeof options.maxCharsPerFile === "number" && Number.isFinite(options.maxCharsPerFile)
				? Math.max(0, Math.floor(options.maxCharsPerFile))
				: 0;
		for (const filePath of ordered) {
			const rawLines = groups.get(filePath);
			if (!rawLines) continue;
			const file = String(filePath || "").trim() || "(unknown)";
			const seen = new Set<string>();
			const uniq: string[] = [];
			for (const ln of rawLines) {
				const s = String(ln ?? "").trim();
				const key = normalizeLineKey(s);
				if (!key) continue;
				if (seen.has(key)) continue;
				seen.add(key);
				uniq.push(s);
			}
			if (uniq.length === 0) continue;
			if (parts.length > 0) parts.push("");
			parts.push(`${file}:`);
			let emittedAny = false;
			let charCount = 0;
			for (const line of uniq) {
				const candidate = String(line || "").trim();
				if (!candidate) continue;
				const estimate = candidate.length + 4;
				if (maxCharsPerFile > 0 && emittedAny && (charCount + estimate) > maxCharsPerFile) break;
				pushBullet(candidate);
				emittedAny = true;
				charCount += estimate;
			}
		}
		return parts.join("\n").trim();
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
	const dateKeys = Array.from(dateKeySet.values());
	dateKeys.sort((a, b) => (a === b ? 0 : a < b ? 1 : -1));

	// Primary anchor date by file across the whole vault index.
	// If a file has a `dateprop` anchor on some other day, suppress `cdate`/`namedate`
	// anchor rows for that file when generating epoch inputs for today (or any other day).
	type PrimaryAnchor = { date: string; priority: number };
	const primaryAnchorByFile = new Map<string, PrimaryAnchor>();
	for (const dayKey of dateKeys) {
		const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
		const fileEntries = entriesByDate.get(dayKey) ?? [];
		const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
		for (const e of dayEntries) {
			if (!e) continue;
			if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
			if (e?.reviewState === "hidden") continue;
			if (isSyntheticPinnedTodayClone(e)) continue;
			if (isRecurringSyntheticEntry(e)) continue;
			const filePath = normalizeEpochInputFilePath(String((e as any)?.file ?? ""));
			if (!filePath) continue;
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

	const epochIndexSnapshotByDateKey = new Map<string, any[]>();
	for (const dayKey of dateKeys) {
		const list = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
		epochIndexSnapshotByDateKey.set(
			dayKey,
			list.filter((e) => e && String((e as any)?.file ?? "").startsWith("epoch://"))
		);
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
	const inboundCounts = getInboundLinkCountIndex();

	let lastYieldAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
	const maybeYield = async () => {
		const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
		if (now - lastYieldAt >= 12) {
			await new Promise((r) => window.setTimeout(r, 0));
			lastYieldAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
		}
	};

	const buckets: ReadonlyArray<EpochBucket> = EPOCH_BUCKET_ORDER;
	const periods = new Map<string, { bucket: EpochBucket; start: string; end: string; dates: Set<string> }>();

	for (let i = 0; i < dateKeys.length; i++) {
		const key = dateKeys[i]!;
		const d = parseDateKey(key);
		if (!d) continue;
		const indexEntries = Array.isArray(index[key]) ? index[key]! : [];
		const fileEntries = entriesByDate.get(key) ?? [];
		const entries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
		const hasNonEpoch = entries.some((e) => e && !String((e as any)?.file ?? "").startsWith("epoch://"));
		const hasChildEpoch = indexEntries.some((e) => {
			if (!e) return false;
			const filePath = String((e as any)?.file ?? "");
			if (!filePath.startsWith("epoch://")) return false;
			const bucket = String((e as any)?.epochBucket ?? "");
			return bucket !== "year";
		});

		for (const e of entries) {
			if (!e) continue;
			const meta = extractEpochMeta(e);
			if (!meta) continue;
			if (meta.start !== key) continue;
			const periodKey = `${meta.bucket}|${meta.start}`;
			const prev = epochByPeriodKey.get(periodKey);
			if (!prev) {
				epochByPeriodKey.set(periodKey, e);
			} else {
				const prevLen = readEpochText(prev).length;
				const nextLen = readEpochText(e).length;
				if (nextLen > prevLen) epochByPeriodKey.set(periodKey, e);
			}
		}

		if (!hasNonEpoch && !hasChildEpoch) {
			if (i % 25 === 0) await maybeYield();
			continue;
		}

		for (const bucket of buckets) {
			if (!hasNonEpoch && bucket !== "year") continue;
			const p = pickEpochPeriod(bucket, d);
			const periodKey = `${bucket}|${p.start}`;
			let rec = periods.get(periodKey);
			if (!rec) {
				rec = { bucket, start: p.start, end: p.end, dates: new Set<string>() };
				periods.set(periodKey, rec);
			}
			rec.dates.add(key);
			if (p.end > rec.end) rec.end = p.end;
		}

		if (i % 25 === 0) await maybeYield();
	}

	const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
	const jobs: AiSummaryJob[] = [];
	let pruned = false;

	const periodList = Array.from(periods.values());
	periodList.sort((a, b) => {
		if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
		if (a.start !== b.start) return a.start < b.start ? -1 : 1;
		return 0;
	});

	for (let pi = 0; pi < periodList.length; pi++) {
		const rec = periodList[pi]!;
		const { bucket, start, end } = rec;
		if (!isDateKey(start) || !isDateKey(end)) continue;
		// After removing the Detailed (full content) mode, epoch inputs are summaries-only.

		const inputGroups = new Map<string, string[]>();
		const statsByFile = new Map<string, EpochInputFileStats>();
		const pushToGroup = (filePath: string, text: string): void => {
			const f = String(filePath || "").trim() || "(unknown)";
			const t = String(text || "").trim();
			if (!t) return;
			const list = inputGroups.get(f) ?? [];
			list.push(t);
			inputGroups.set(f, list);
		};
		const rangeKeysNewestFirst = Array.from(rec.dates.values()).sort().reverse();
		const anchorSelectionByFile = new Map<string, { key: string; sortIdx: number; priority: number }>();
		const entryKeyForDedupe = (e: any, filePath: string, dayKey: string): string => {
			const source = String((e as any)?.source ?? "");
			const date = String((e as any)?.date ?? dayKey);
			const blockStart = Number((e as any)?.blockStart ?? 0);
			const blockEnd = Number((e as any)?.blockEnd ?? blockStart);
			const trackedHash = String((e as any)?.trackedHash ?? "");
			return [source, filePath, date, String(blockStart), String(blockEnd), trackedHash].join("|");
		};
		for (let idx = 0; idx < rangeKeysNewestFirst.length; idx++) {
			const dayKey = rangeKeysNewestFirst[idx]!;
			const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
			const fileEntries = entriesByDate.get(dayKey) ?? [];
			const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
			for (const e of dayEntries) {
				if (!e) continue;
				if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
				if (e?.reviewState === "hidden") continue;
				if (isSyntheticPinnedTodayClone(e)) continue;
				if (isRecurringSyntheticEntry(e)) continue;
				const rawPath = normalizeEpochInputFilePath(String((e as any)?.file ?? "")) || "(unknown)";
				const source = String((e as any)?.source ?? "");
				if (!isAnchorSource(source)) continue;
				const primary = primaryAnchorByFile.get(rawPath);
				const entryDate = String((e as any)?.date ?? dayKey);
				if (primary && entryDate && entryDate !== primary.date) continue;
				const key = entryKeyForDedupe(e, rawPath, dayKey);
				const priority = getAnchorPriority(source);
				const prev = anchorSelectionByFile.get(rawPath);
				if (!prev) {
					anchorSelectionByFile.set(rawPath, { key, sortIdx: idx, priority });
					continue;
				}
				// Prefer anchor kind over recency: if a file has both cdate and dateprop
				// within the period, include only the higher-priority anchor (dateprop).
				if (priority > prev.priority) {
					anchorSelectionByFile.set(rawPath, { key, sortIdx: idx, priority });
				} else if (priority === prev.priority && idx < prev.sortIdx) {
					anchorSelectionByFile.set(rawPath, { key, sortIdx: idx, priority });
				}
			}
		}

		const resolveEpochInputItemText = async (e: any): Promise<string> => formatEpochItemText(plugin, e);
		for (const dayKey of rangeKeysNewestFirst) {
			const indexEntries = Array.isArray(index[dayKey]) ? index[dayKey]! : [];
			const fileEntries = entriesByDate.get(dayKey) ?? [];
			const dayEntries = indexEntries.length > 0 ? indexEntries.concat(fileEntries as any[]) : (fileEntries as any[]);
			for (const e of dayEntries) {
				if (!e) continue;
				if (String((e as any)?.file ?? "").startsWith("epoch://")) continue;
				if (e?.reviewState === "hidden") continue;
				if (isSyntheticPinnedTodayClone(e)) continue;
				if (isRecurringSyntheticEntry(e)) continue;
				const filePath = normalizeEpochInputFilePath(String((e as any)?.file ?? "")) || "(unknown)";
				try {
					const src = String((e as any)?.source ?? "");
					if (isAnchorSource(src)) {
						const primary = primaryAnchorByFile.get(filePath);
						const entryDate = String((e as any)?.date ?? dayKey);
						if (primary && entryDate && entryDate !== primary.date) continue;
					}
				} catch {
					// ignore
				}
				const anchor = anchorSelectionByFile.get(filePath);
				if (anchor) {
					const key = entryKeyForDedupe(e, filePath, dayKey);
					if (key !== anchor.key) continue;
				}
				const text = await resolveEpochInputItemText(e);
				if (!text) continue;
				pushToGroup(filePath, text);
				const st = statsByFile.get(filePath) ?? { records: 0, markedRecords: 0, pinnedRecords: 0, anchorRecords: 0, newestDayKey: dayKey };
				st.records += 1;
				try {
					if (e?.pinned === true) st.pinnedRecords += 1;
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
			}
		}
		const orderedFiles = buildOrderedFileListForIntent(bucket, inputGroups, statsByFile, inboundCounts);
		let inputText = buildGroupedEpochInputText(inputGroups, {
			orderedFiles: orderedFiles,
			maxCharsPerFile: getPerFileCharCapForBucket(bucket)
		});
		if (!inputText && bucket === "year") {
			const childGroups = new Map<string, string[]>();
			for (const dayKey of rangeKeysNewestFirst) {
				const epochEntries = epochIndexSnapshotByDateKey.get(dayKey) ?? [];
				for (const e of epochEntries) {
					if (!e) continue;
					const meta = extractEpochMeta(e);
					if (!meta) continue;
					if (meta.bucket === "year") continue;
					const epochFilePath = String((e as any)?.file ?? "");
					if (!epochFilePath.startsWith("epoch://")) continue;
					const text = formatEpochItemText(plugin, { ...(e as any), file: epochFilePath });
					if (!text) continue;
					const list = childGroups.get(epochFilePath) ?? [];
					list.push(text);
					childGroups.set(epochFilePath, list);
				}
			}
			if (childGroups.size > 0) {
				inputText = buildGroupedEpochInputText(childGroups);
			}
		}

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
		const related = clipRelated(await buildRelatedSummariesForFiles(plugin, Array.from(inputGroups.keys())));
		const existingText = matchingEpoch ? readEpochText(matchingEpoch as any) : "";
		const existingHash = matchingEpoch ? String((matchingEpoch as any).aiSummaryInputHash || "") : "";
		const isFresh = !!existingText && existingHash === inputHash;

		if (mode === "missing") {
			if (existingText) continue;
		} else if (mode === "staleOrMissing") {
			if (isFresh) continue;
		}

		const chunks = splitIntoAiChunksByLines(inputText, tuning.maxChunkChars)
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

		if (pi % 25 === 0) {
			await maybeYield();
		}
	}

	const sorted = sortEpochJobsByHierarchy(jobs);

	if (pruned) {
		schedulePersist(plugin);
	}

	return sorted;
}
