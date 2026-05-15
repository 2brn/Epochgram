import type { EpochPlugin } from "../../main";
import type { FileDateEntry, FileIndexData } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import { computeAiSummaryInputHash, isLikelyTextFilePath } from "../../utils";
import { extractFrontmatterDescription } from "../../indexer/summarizer";
import { buildPerCallContext } from "./contexts";
import { getAiSummaryTuning } from "./bridge-settings";
import { getIndexerInternals, getLinesForFile } from "./indexer";
import { buildRelatedSummariesAllDates, getRelatedScoredForFile } from "./related";
import { getYamlDatePropertyKey, getYamlDescriptionPropertyKey } from "../frontmatter-keys";
import { splitIntoAiChunks } from "./shared";

function sanitizeAiInputText(input: string): string {
	const raw = String(input || "");
	if (!raw) return "";
	let s = raw;
	s = s.replace(/^\uFEFF/, "");
	s = s.replace(/^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");
	s = s.replace(/```[\s\S]*?```/g, " ");
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	s = s.replace(/`([^`]+)`/g, "$1");
	s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
	s = s.replace(/\*\*(.*?)\*\*/g, "$1");
	s = s.replace(/__(.*?)__/g, "$1");
	s = s.replace(/(^|\s)\*(\S(?:[\s\S]*?\S)?)\*(?=\s|$)/g, "$1$2");
	s = s.replace(/(^|\s)_(\S(?:[\s\S]*?\S)?)_(?=\s|$)/g, "$1$2");
	s = s.replace(/<[^>]+>/g, "");
	s = s.replace(/[ \t]+/g, " ");
	s = s.replace(/\n{3,}/g, "\n\n");
	return s.trim();
}

function isOnlyDateFrontmatter(lines: string[], datePropertyKey: string): boolean {
	if (!Array.isArray(lines) || lines.length === 0) return false;
	const stripBom = (s: string): string => (s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
	const first = stripBom(String(lines[0] ?? "")).trim();
	if (first !== "---") return false;
	let endIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		const t = String(lines[i] ?? "").trim();
		if (t === "---" || t === "...") {
			endIdx = i;
			break;
		}
	}
	if (endIdx < 0) return false;

	const body = lines.slice(endIdx + 1).join("\n").trim();
	if (body) return false;

	let sawDate = false;
	for (const raw of lines.slice(1, endIdx)) {
		const trimmed = String(raw ?? "").trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#")) continue;
		// Any indentation implies nesting/structure beyond a single `date:` key.
		if (/^\s+/.test(String(raw ?? ""))) return false;
		const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
		if (!m) return false;
		const key = String(m[1] ?? "").toLowerCase();
		const value = String(m[2] ?? "").trim();
		if (key !== String(datePropertyKey || "").toLowerCase()) return false;
		if (!value) return false;
		if (sawDate) return false;
		sawDate = true;
	}
	return sawDate;
}

export async function buildJobsForFile(
	plugin: EpochPlugin,
	filePath: string,
	force: boolean
): Promise<{ jobs: AiSummaryJob[]; reason?: string }> {
	if (!isLikelyTextFilePath(filePath)) return { jobs: [], reason: "Only text files are supported" };
	const internals = getIndexerInternals(plugin);
	if (!internals) return { jobs: [], reason: "Indexer not ready" };
	const data = internals.files[filePath];
	if (!data) return { jobs: [], reason: "File not indexed" };
	const lines = await getLinesForFile(plugin, filePath);
	if (lines.length === 0) return { jobs: [], reason: "File is empty or unreadable" };
	const tuning = getAiSummaryTuning(plugin);
	const maxInputChars = tuning.recordsMaxInputChars;
	const maxRelatedChars = tuning.maxRelatedChars;
	const maxChunkChars = tuning.maxChunkChars;

	const joinLinesUpToChars = (ls: string[], maxChars: number): string => {
		if (!ls || ls.length === 0) return "";
		if (!(maxChars > 0)) return "";
		let out = "";
		for (let i = 0; i < ls.length; i++) {
			const next = (out ? "\n" : "") + String(ls[i] ?? "");
			if (out.length + next.length > maxChars) break;
			out += next;
		}
		return out;
	};

	const fullTextRaw = lines.length > 0 ? joinLinesUpToChars(lines, maxInputChars) : "";
	const fullText = sanitizeAiInputText(fullTextRaw);
	const datePropertyKey = getYamlDatePropertyKey(plugin);
	const descriptionPropertyKey = getYamlDescriptionPropertyKey(plugin);
	if (isOnlyDateFrontmatter(lines, datePropertyKey)) return { jobs: [], reason: "File is empty" };
	if (extractFrontmatterDescription(fullTextRaw, descriptionPropertyKey)) return { jobs: [], reason: "YAML description exists" };
	if (!fullText.trim()) return { jobs: [], reason: "File is empty" };

	const jobs: AiSummaryJob[] = [];
	const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

	const relatedScored = await getRelatedScoredForFile(plugin, filePath);
	let relatedAllDatesCache: string | null = null;
	const getRelatedAllDates = (): string => {
		if (relatedAllDatesCache != null) return relatedAllDatesCache;
		relatedAllDatesCache = buildRelatedSummariesAllDates(plugin, relatedScored);
		return relatedAllDatesCache;
	};

	type GroupType = "anchor" | "content" | "tracked";
	type JobTarget = NonNullable<AiSummaryJob["targets"]>[number];
	const toTarget = (entry: FileDateEntry, kind: JobTarget["kind"]): JobTarget => ({
		kind,
		date: entry.date,
		blockStart: entry.blockStart,
		blockEnd: entry.blockEnd,
		source: entry.source
	});
	const computeGroupHash = (groupDate: string, groupType: GroupType, groupInput: string): string => {
		const key = groupType === "anchor" ? "anchor" : `${groupDate}|${groupType}`;
		return computeAiSummaryInputHash(filePath, key, groupInput, maxInputChars);
	};
	const groupHasFreshAi = (entries: FileDateEntry[], expectedHash: string): boolean => {
		if (force) return false;
		if (!entries.length) return false;
		return entries.every(e => {
			const h = typeof (e as any).aiSummaryInputHash === "string" ? (e as any).aiSummaryInputHash : "";
			const s = typeof (e as any).aiSummary === "string" ? (e as any).aiSummary.trim() : "";
			return !!s && h === expectedHash;
		});
	};
	const pushGroupJobs = (args: {
		groupType: GroupType;
		groupDate: string;
		representative: FileDateEntry;
		kind: AiSummaryJob["kind"];
		targetEntries: FileDateEntry[];
		inputText: string;
	}) => {
		const groupInputRaw = sanitizeAiInputText(String(args.inputText ?? "")).trim();
		if (!groupInputRaw) return;
		const groupInput = groupInputRaw.length > maxInputChars ? groupInputRaw.slice(0, maxInputChars) : groupInputRaw;
		const inputHash = computeGroupHash(args.groupDate, args.groupType, groupInput);
		if (groupHasFreshAi(args.targetEntries, inputHash)) return;
		const relatedRaw = getRelatedAllDates();
		const related = relatedRaw.length > maxRelatedChars ? relatedRaw.slice(0, maxRelatedChars) : relatedRaw;
		const targets: JobTarget[] = args.targetEntries.map(e => {
			// Targets must point to the correct *container* where the entries live.
			// Filename date-range “extra days” are stored under `contentDates` but
			// preserve `source: "namedate"`, so we cannot derive `kind` from `source`.
			const k: JobTarget["kind"] =
				args.groupType === "content" ? "content" :
				args.groupType === "tracked" ? "tracked" :
				e.source === "cdate" ? "cdate" :
				e.source === "dateprop" ? "dateProp" :
				e.source === "namedate" ? (e === data.namedDate ? "namedDate" : "content") :
				"content";
			return toTarget(e, k);
		});
		const baseJob = {
			filePath,
			kind: args.kind,
			date: args.representative.date,
			blockStart: args.representative.blockStart,
			blockEnd: args.representative.blockEnd,
			source: args.representative.source,
			context: buildPerCallContext(filePath, args.representative, related),
			related,
			inputHash,
			createdAt: Date.now(),
			targets,
			groupType: args.groupType,
			groupDate: args.groupDate
		};
		const chunks = splitIntoAiChunks(groupInput, maxChunkChars)
			.map((chunk) => String(chunk || "").trim())
			.filter(Boolean);
		if (groupInput.length <= maxChunkChars || chunks.length <= 1) {
			jobs.push({
				id: mkId(),
				...baseJob,
				input: groupInput
			});
			return;
		}

		const groupId = mkId();
		for (let i = 0; i < chunks.length; i++) {
			jobs.push({
				id: mkId(),
				...baseJob,
				input: chunks[i]!,
				reduce: true,
				reduceDepth: 0,
				groupId,
				chunkIndex: i,
				chunkCount: chunks.length
			});
		}
	};

	const anchorEntries: FileDateEntry[] = [];
	if (data.namedDate) anchorEntries.push(data.namedDate);
	if (data.dateProp) anchorEntries.push(data.dateProp);
	if (data.cdate) anchorEntries.push(data.cdate);
	for (const e of data.contentDates ?? []) {
		if (!e) continue;
		if (e.source !== "namedate") continue;
		anchorEntries.push(e);
	}
	if (anchorEntries.length > 0) {
		const rep = anchorEntries[0]!;
		pushGroupJobs({
			groupType: "anchor",
			groupDate: rep.date,
			representative: rep,
			kind:
				rep.source === "namedate" ? "namedDate" :
				rep.source === "dateprop" ? "dateProp" :
				"cdate",
			targetEntries: anchorEntries,
			inputText: fullText
		});
	}

	const contentByDate = new Map<string, FileDateEntry[]>();
	for (const entry of data.contentDates ?? []) {
		if (entry && entry.source === "namedate") continue;
		(contentByDate.get(entry.date) ?? contentByDate.set(entry.date, []).get(entry.date)!).push(entry);
	}
	for (const [date, entries] of contentByDate) {
		const rep = entries[0]!;
		const parts = entries
			.map(e => sanitizeAiInputText(lines.slice(e.blockStart, e.blockEnd + 1).join("\n").trim()))
			.filter(Boolean);
		pushGroupJobs({
			groupType: "content",
			groupDate: date,
			representative: rep,
			kind: "content",
			targetEntries: entries,
			inputText: parts.join("\n\n")
		});
	}

	for (const [date, entries] of Object.entries(data.trackedDates ?? {})) {
		if (!Array.isArray(entries) || entries.length === 0) continue;
		const rep = entries[0]!;
		const parts = entries.map(e => sanitizeAiInputText(String(e.summary ?? "").trim())).filter(Boolean);
		pushGroupJobs({
			groupType: "tracked",
			groupDate: date,
			representative: rep,
			kind: "tracked",
			targetEntries: entries,
			inputText: parts.join("\n")
		});
	}

	if (jobs.length === 0) {
		return { jobs: [], reason: "No timeline records found in this file" };
	}
	return { jobs };
}

function newestDateForFileData(data: FileIndexData | undefined | null): string {
	if (!data) return "";
	let max = "";
	const consider = (d: any) => {
		const s = typeof d === "string" ? d : "";
		if (s && s > max) max = s;
	};
	consider(data.cdate?.date);
	consider(data.namedDate?.date);
	consider(data.dateProp?.date);
	for (const e of data.contentDates ?? []) {
		consider((e as any)?.date);
	}
	for (const k of Object.keys(data.trackedDates ?? {})) {
		consider(k);
	}
	return max;
}

export function getIndexedPathsNewestFirst(plugin: EpochPlugin): string[] {
	const internals = getIndexerInternals(plugin);
	if (!internals) return [];
	return Object.keys(internals.files)
		.map(path => ({ path, newest: newestDateForFileData(internals.files[path]) }))
		.sort((a, b) => {
			if (a.newest !== b.newest) return a.newest < b.newest ? 1 : -1;
			return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
		})
		.map(x => x.path);
}

export function sortJobsNewestFirst(jobs: AiSummaryJob[]): AiSummaryJob[] {
	const groupTypeOrder = (t: any): number => (t === "anchor" ? 0 : t === "content" ? 1 : t === "tracked" ? 2 : 9);
	return jobs.slice().sort((a, b) => {
		const da = String((a as any).groupDate ?? a.date ?? "");
		const db = String((b as any).groupDate ?? b.date ?? "");
		if (da !== db) return da < db ? 1 : -1;
		const ta = groupTypeOrder((a as any).groupType);
		const tb = groupTypeOrder((b as any).groupType);
		if (ta !== tb) return ta - tb;
		const ga = String((a as any).groupId ?? "");
		const gb = String((b as any).groupId ?? "");
		if (ga !== gb) return ga < gb ? -1 : 1;
		const ia = typeof (a as any).chunkIndex === "number" ? (a as any).chunkIndex : 999999;
		const ib = typeof (b as any).chunkIndex === "number" ? (b as any).chunkIndex : 999999;
		if (ia !== ib) return ia - ib;
		const ca = typeof a.createdAt === "number" ? a.createdAt : 0;
		const cb = typeof b.createdAt === "number" ? b.createdAt : 0;
		return ca - cb;
	});
}

export async function countMissingAiSummaries(plugin: EpochPlugin): Promise<number> {
	const internals = getIndexerInternals(plugin);
	if (!internals) return 0;

	const hasAi = (entry: any): boolean => {
		const s = typeof entry?.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const h = typeof entry?.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		return !!s && !!h;
	};

	let missing = 0;
	for (const [filePath, data] of Object.entries(internals.files)) {
		if (!data) continue;
		if (!isLikelyTextFilePath(filePath)) continue;

		const groups = new Map<string, { groupType: "anchor" | "content" | "tracked"; entry: FileDateEntry; eligible?: boolean }>();
		const addGroup = (entry: FileDateEntry, groupType: "anchor" | "content" | "tracked"): void => {
			const date = String((entry as any)?.date ?? "");
			if (!date) return;
			const key = `${date}|${groupType}`;
			if (!groups.has(key)) groups.set(key, { groupType, entry });
		};

		if (data.cdate) addGroup(data.cdate, "anchor");
		if (data.namedDate) addGroup(data.namedDate, "anchor");
		if (data.dateProp) addGroup(data.dateProp, "anchor");
		for (const e of Array.isArray(data.contentDates) ? data.contentDates : []) addGroup(e, "content");
		for (const list of Object.values(data.trackedDates ?? {})) {
			for (const e of Array.isArray(list) ? list : []) addGroup(e, "tracked");
		}
		if (groups.size === 0) continue;

		const lines = await getLinesForFile(plugin, filePath);
		const fullText = lines.length > 0 ? lines.join("\n").trim() : "";
		const hasText = fullText.length > 0;

		for (const rec of groups.values()) {
			const entry = rec.entry;
			if (!entry) continue;
			if (rec.groupType === "tracked") {
				rec.eligible = String((entry as any).summary ?? "").trim().length > 0;
			} else {
				rec.eligible = hasText;
			}
			if (!rec.eligible) continue;
			if (!hasAi(entry as any)) missing++;
		}
	}

	return missing;
}

export function hasMissingAiSummariesFast(plugin: EpochPlugin): boolean {
	const internals = getIndexerInternals(plugin);
	if (!internals) return false;

	const hasAi = (entry: any): boolean => {
		const s = typeof entry?.aiSummary === "string" ? entry.aiSummary.trim() : "";
		const h = typeof entry?.aiSummaryInputHash === "string" ? entry.aiSummaryInputHash.trim() : "";
		return !!s && !!h;
	};
	const hasEvidenceOfText = (entry: any): boolean => {
		const s = typeof entry?.summary === "string" ? entry.summary.trim() : "";
		return s.length > 0;
	};

	for (const [filePath, data] of Object.entries(internals.files)) {
		if (!data) continue;
		if (!isLikelyTextFilePath(filePath)) continue;

		const entries: FileDateEntry[] = [];
		if (data.cdate) entries.push(data.cdate);
		if (data.namedDate) entries.push(data.namedDate);
		if (data.dateProp) entries.push(data.dateProp);
		if (Array.isArray(data.contentDates)) entries.push(...data.contentDates);
		if (data.trackedDates) entries.push(...Object.values(data.trackedDates).flat());
		if (entries.length === 0) continue;

		for (const entry of entries) {
			if (!entry) continue;
			if (hasAi(entry as any)) continue;
			if (entry.source === "tracked") {
				if (hasEvidenceOfText(entry)) return true;
				continue;
			}
			if (hasEvidenceOfText(entry)) return true;
		}
	}

	return false;
}
