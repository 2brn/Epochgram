import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { FileDateEntry } from "../../indexer/types";
import { sanitizeSummaryText } from "../../utils";
import type { AiBridgeServer, AiSummaryJob } from "../ai-bridge";
import { buildEpochReduceContext, buildReduceContext } from "./contexts";
import { getAiSummaryTuning } from "./bridge-settings";
import { getIndexerInternals, resolveTargetEntries } from "./indexer";
import { schedulePersist } from "./persistence";
import { isDateKey, splitIntoAiChunksByLines } from "./shared";
import { isEpochJob, storeEpochSummary } from "./epochs-store";
import { formatAiSummaryOutput } from "../ai-summary-format";
import { clearEpochInputAiSummaryError, markEpochInputAiSummaryError } from "./epoch-input-ai-fallback";
import { isGenerateEpochsEffective, isSummarizeAIEffective } from "../pro-feature-state";

type EpochBucket = "day" | "2days" | "4days" | "week" | "2weeks" | "month" | "3months" | "6months" | "year";
type EpochStart = string;
type EpochEnd = string;

type ChunkGroupState = {
	filePath: string;
	kind: AiSummaryJob["kind"];
	date: string;
	blockStart: number;
	blockEnd: number;
	source: string;
	epochBucket?: EpochBucket;
	epochStart?: string;
	epochEnd?: string;
	related?: string;
	targets?: NonNullable<AiSummaryJob["targets"]>;
	groupType?: AiSummaryJob["groupType"];
	groupDate?: AiSummaryJob["groupDate"];
	inputHash: string;
	depth: number;
	chunkCount: number;
	done: Set<number>;
	summaries: Map<number, string>;
	fallbackText?: string;
	createdAt: number;
};

type ResultHandlerRuntime = {
	aiBridgeChunkGroups?: Map<string, ChunkGroupState>;
	aiBridgeReduceFallbackByJobId?: Map<string, string>;
	queueVectorUpdate?: (filePath: string) => void;
	queueTermSimilarityUpdate?: (filePath: string) => void;
	enqueueEpochsForDateKeys?: (dateKeys: string[], options?: { force?: boolean; showNotice?: boolean }) => Promise<void>;
	aiBridge?: AiBridgeServer | null;
};

type ResultHandlerIndexerRuntime = {
	updateAggregatedEntries?: (filePath: string) => void;
};

type MutableSummaryEntry = FileDateEntry & {
	aiSummary?: string;
	aiSummaryInputHash?: string;
	aiSummaryVisible?: boolean;
};

type ResultJobExtras = {
	timelineVisible?: boolean;
	epochBucket?: EpochBucket;
	epochStart?: EpochStart;
	epochEnd?: EpochEnd;
	related?: string;
};

function getRuntime(plugin: EpochPlugin): ResultHandlerRuntime {
	return plugin as unknown as ResultHandlerRuntime;
}

function getJobExtras(job: AiSummaryJob): ResultJobExtras {
	return job;
}

function getChunkGroups(plugin: EpochPlugin): Map<string, ChunkGroupState> {
	const runtime = getRuntime(plugin);
	if (!runtime.aiBridgeChunkGroups) {
		runtime.aiBridgeChunkGroups = new Map<string, ChunkGroupState>();
	}
	return runtime.aiBridgeChunkGroups;
}

function getReduceFallbackByJobId(plugin: EpochPlugin): Map<string, string> {
	const runtime = getRuntime(plugin);
	if (!runtime.aiBridgeReduceFallbackByJobId) {
		runtime.aiBridgeReduceFallbackByJobId = new Map<string, string>();
	}
	return runtime.aiBridgeReduceFallbackByJobId;
}

function storeEntrySummaries(plugin: EpochPlugin, job: AiSummaryJob, entries: FileDateEntry[], rawSummary: string): void {
	const runtime = getRuntime(plugin);
	const extras = getJobExtras(job);
	const finalText = formatAiSummaryOutput(rawSummary);
	if (!finalText) return;
	clearEpochInputAiSummaryError(plugin, entries);
	const explicitVisible = (() => {
		try {
			if (isSummarizeAIEffective(plugin)) return true;
		} catch {
			// ignore
		}
		return extras.timelineVisible === true;
	})();

	for (const entry of entries) {
		const mutable = entry as MutableSummaryEntry;
		mutable.aiSummary = finalText;
		mutable.aiSummaryInputHash = job.inputHash;
		mutable.aiSummaryVisible = explicitVisible;
	}

	const indexer = plugin.indexer as unknown as ResultHandlerIndexerRuntime;
	try {
		indexer.updateAggregatedEntries?.(job.filePath);
	} catch {
		// ignore
	}
	schedulePersist(plugin);
	if (explicitVisible) {
		try {
			runtime.queueVectorUpdate?.(job.filePath);
		} catch {
			// ignore
		}
		try {
			runtime.queueTermSimilarityUpdate?.(job.filePath);
		} catch {
			// ignore
		}
	}

	try {
		if (plugin?.hasProAccess?.() && Platform.isDesktop && isGenerateEpochsEffective(plugin)) {
			const dateKeys = Array.from(new Set(entries.map((e) => e.date).filter(isDateKey)));
			if (dateKeys.length > 0 && typeof runtime.enqueueEpochsForDateKeys === "function") {
				void runtime.enqueueEpochsForDateKeys(dateKeys, { force: false, showNotice: false });
			}
		}
	} catch { void 0; }
}

function isRejectedAiSummary(raw: string): boolean {
	try {
		let s = sanitizeSummaryText(String(raw ?? ""))
			.replace(/\r\n?/g, "\n")
			.trim();
		if (!s) return true;
		s = s.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "").trim();
		s = s.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
		return s.toLowerCase() === "no text provided";
	} catch {
		return false;
	}
}

function dedupeOrderedParts(parts: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const p of parts) {
		const t = String(p || "").trim();
		if (!t) continue;
		if (seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

function dedupeNonEmptyLines(text: string): string {
	const raw = String(text ?? "");
	if (!raw.trim()) return "";
	const INVISIBLE_FORMAT_CHARS_RE = /\u00AD|\u034F|\u061C|\u180E|[\u200B-\u200F]|[\u202A-\u202E]|[\u2060-\u206F]|\uFEFF/g;
	const normalizeKey = (line: string): string => {
		try {
			return String(line ?? "")
				.normalize("NFKC")
				// Remove invisible format characters that can make two lines *look* identical
				// but compare different (soft hyphen, zero-width, bidi marks, BOM, etc).
				.replace(INVISIBLE_FORMAT_CHARS_RE, "")
				.replace(/[“”]/g, '"')
				.replace(/[‘’]/g, "'")
				.replace(/\s+/g, " ")
				.trim();
		} catch {
			return String(line ?? "").trim();
		}
	};
	const lines = raw.split(/\r\n|\n|\r|\u2028|\u2029/g);
	const out: string[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const s = String(line ?? "");
		const key = normalizeKey(s);
		if (!key) {
			out.push("");
			continue;
		}
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	// Avoid trailing whitespace-only lines after de-dupe.
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function handleBridgeResult(plugin: EpochPlugin, job: AiSummaryJob, result: { summary?: string; error?: string }): void {
	const runtime = getRuntime(plugin);
	const extras = getJobExtras(job);
	const tuning = getAiSummaryTuning(plugin);
	const hasError = typeof result.error === "string" && result.error.trim().length > 0;
	const summary = typeof result.summary === "string" ? result.summary : "";
	const hasUsableSummary = !!summary.trim() && !isRejectedAiSummary(summary);

	const groupId = job.groupId;
	const chunkCount = typeof job.chunkCount === "number" ? job.chunkCount : null;
	const chunkIndex = typeof job.chunkIndex === "number" ? job.chunkIndex : null;
	const isChunked = !!groupId && !!chunkCount && chunkCount > 1 && chunkIndex != null;
	const epochJob = isEpochJob(job);

	if (epochJob) {
		if (!isChunked) {
			const reduceFallbackByJobId = getReduceFallbackByJobId(plugin);
			const fallback = job.id ? reduceFallbackByJobId.get(job.id) : undefined;
			if (hasError || !hasUsableSummary) {
				if (fallback && fallback.trim()) {
					reduceFallbackByJobId.delete(job.id);
					storeEpochSummary(plugin, job, fallback);
				}
				return;
			}
			if (job.id) reduceFallbackByJobId.delete(job.id);
			storeEpochSummary(plugin, job, summary);
			return;
		}

		const groups = getChunkGroups(plugin);
		const groupIdKey = String(groupId);
		const chunkCountNum = chunkCount ?? 0;
		let g = groups.get(groupIdKey);
		if (!g) {
			g = {
				filePath: job.filePath,
				kind: job.kind,
				date: job.date,
				blockStart: job.blockStart,
				blockEnd: job.blockEnd,
				source: job.source,
				epochBucket: extras.epochBucket,
				epochStart: extras.epochStart,
				epochEnd: extras.epochEnd,
				related: extras.related,
				inputHash: job.inputHash,
				depth: 0,
				chunkCount: chunkCountNum,
				done: new Set<number>(),
				summaries: new Map<number, string>(),
				createdAt: Date.now()
			};
			groups.set(groupIdKey, g);
		}
		if (g.inputHash !== job.inputHash) {
			g.inputHash = job.inputHash;
			g.chunkCount = chunkCountNum;
			g.done.clear();
			g.summaries.clear();
			g.fallbackText = undefined;
			g.createdAt = Date.now();
			g.depth = 0;
			g.epochBucket = extras.epochBucket;
			g.epochStart = extras.epochStart;
			g.epochEnd = extras.epochEnd;
			g.related = extras.related;
		}
		g.done.add(chunkIndex ?? 0);
		if (!hasError && hasUsableSummary) {
			g.summaries.set(chunkIndex ?? 0, summary);
		}

		if (g.done.size >= g.chunkCount) {
			const successfulChunks = g.summaries.size;
			if (successfulChunks <= 0) {
				groups.delete(groupIdKey);
				const fb = (g.fallbackText ?? "").trim();
				if (fb) storeEpochSummary(plugin, job, fb);
				return;
			}

			const orderedRaw: string[] = [];
			for (let i = 0; i < g.chunkCount; i++) {
				const part = g.summaries.get(i) ?? "";
				if (part.trim()) orderedRaw.push(part.trim());
			}
			const ordered = dedupeOrderedParts(orderedRaw);
			groups.delete(groupIdKey);
			const combined = ordered.join("\n").trim();
			if (!combined) {
				const fb = (g.fallbackText ?? "").trim();
				if (fb) storeEpochSummary(plugin, job, fb);
				return;
			}

			const depth = typeof g.depth === "number" ? g.depth : 0;
			const bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
			if (!bridge || depth >= tuning.reduceMaxDepth) {
				storeEpochSummary(plugin, job, combined);
				return;
			}

			const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
			const nextDepth = depth + 1;
			const combinedForReduce = dedupeNonEmptyLines(combined) || combined;
			const reduceChunks = dedupeOrderedParts(
				splitIntoAiChunksByLines(combinedForReduce, tuning.maxChunkChars)
					.map(c => dedupeNonEmptyLines(c))
					.filter(c => c && c.trim())
			);
			if (reduceChunks.length === 0) return;

			if (reduceChunks.length === 1) {
				const reduceJobId = mkId();
				getReduceFallbackByJobId(plugin).set(reduceJobId, combined);
				const epochBucket: EpochBucket = g.epochBucket ?? extras.epochBucket ?? "day";
				const epochStart = g.epochStart ?? extras.epochStart ?? job.date;
				const epochEnd = g.epochEnd ?? extras.epochEnd ?? epochStart;
				const related = String(g.related ?? extras.related ?? "");
				bridge.enqueue([
					{
						id: reduceJobId,
						filePath: job.filePath,
						kind: "epoch",
						date: job.date,
						blockStart: job.blockStart,
						blockEnd: job.blockEnd,
						source: job.source,
						input: reduceChunks[0],
						related,
						context: buildEpochReduceContext(epochBucket, epochStart, epochEnd, related),
						reduce: true,
						reduceDepth: nextDepth,
						inputHash: job.inputHash,
						createdAt: Date.now(),
						epochBucket,
						epochStart,
						epochEnd
					}
				]);
				return;
			}

			const nextGroupId = mkId();
			groups.set(nextGroupId, {
				filePath: job.filePath,
				kind: "epoch",
				date: job.date,
				blockStart: job.blockStart,
				blockEnd: job.blockEnd,
				source: job.source,
				epochBucket: g.epochBucket ?? extras.epochBucket,
				epochStart: g.epochStart ?? extras.epochStart,
				epochEnd: g.epochEnd ?? extras.epochEnd,
				inputHash: job.inputHash,
				depth: nextDepth,
				chunkCount: reduceChunks.length,
				done: new Set<number>(),
				summaries: new Map<number, string>(),
				fallbackText: combined,
				related: g.related ?? extras.related,
				createdAt: Date.now()
			});
			const epochBucket: EpochBucket = g.epochBucket ?? extras.epochBucket ?? "day";
			const epochStart = g.epochStart ?? extras.epochStart ?? job.date;
			const epochEnd = g.epochEnd ?? extras.epochEnd ?? epochStart;
			const related = String(g.related ?? extras.related ?? "");
			const epochReduceContext = buildEpochReduceContext(epochBucket, epochStart, epochEnd, related);
			const reduceJobs: AiSummaryJob[] = [];
			for (let i = 0; i < reduceChunks.length; i++) {
				reduceJobs.push({
					id: mkId(),
					groupId: nextGroupId,
					chunkIndex: i,
					chunkCount: reduceChunks.length,
					filePath: job.filePath,
					kind: "epoch",
					date: job.date,
					blockStart: job.blockStart,
					blockEnd: job.blockEnd,
					source: job.source,
					input: reduceChunks[i],
					related,
					context: epochReduceContext,
					reduce: true,
					reduceDepth: nextDepth,
					inputHash: job.inputHash,
					createdAt: Date.now(),
					epochBucket,
					epochStart,
					epochEnd
				});
			}
			bridge.enqueue(reduceJobs);
		}
		return;
	}

	const internals = getIndexerInternals(plugin);
	if (!internals) return;
	const data = internals.files[job.filePath];
	if (!data) return;
	const entries = resolveTargetEntries(data, job);
	if (entries.length === 0) return;
	const representative = entries[0];

	if (!isChunked) {
		const reduceFallbackByJobId = getReduceFallbackByJobId(plugin);
		const fallback = job.id ? reduceFallbackByJobId.get(job.id) : undefined;
		if (hasError || !hasUsableSummary) {
			if (fallback && fallback.trim()) {
				reduceFallbackByJobId.delete(job.id);
				storeEntrySummaries(plugin, job, entries, fallback);
			}
			else {
				markEpochInputAiSummaryError(plugin, entries, job.inputHash, result.error ?? "(no summary)");
			}
			return;
		}
		if (job.id) reduceFallbackByJobId.delete(job.id);
		storeEntrySummaries(plugin, job, entries, summary);
		return;
	}

	const groupIdKey = String(groupId);
	const chunkCountNum = chunkCount ?? 0;
	const chunkIndexNum = chunkIndex ?? 0;

	const groups = getChunkGroups(plugin);
	let g = groups.get(groupIdKey);
	if (!g) {
		g = {
			filePath: job.filePath,
			kind: job.kind,
			date: job.date,
			blockStart: job.blockStart,
			blockEnd: job.blockEnd,
			source: job.source,
			related: extras.related,
			targets: job.targets,
			groupType: job.groupType,
			groupDate: job.groupDate,
			inputHash: job.inputHash,
			depth: 0,
			chunkCount: chunkCountNum,
			done: new Set<number>(),
			summaries: new Map<number, string>(),
			createdAt: Date.now()
		};
		groups.set(groupIdKey, g);
	}
	if (g.inputHash !== job.inputHash) {
		g.inputHash = job.inputHash;
		g.chunkCount = chunkCountNum;
		g.done.clear();
		g.summaries.clear();
		g.fallbackText = undefined;
		g.createdAt = Date.now();
		g.depth = 0;
		g.targets = job.targets;
		g.groupType = job.groupType;
		g.groupDate = job.groupDate;
		g.related = extras.related;
	}
	g.done.add(chunkIndexNum);
	if (!hasError && hasUsableSummary) {
		g.summaries.set(chunkIndexNum, summary);
	}

	if (g.done.size >= g.chunkCount) {
		const successfulChunks = g.summaries.size;
		if (successfulChunks <= 0) {
			groups.delete(groupIdKey);
			const fb = (g.fallbackText ?? "").trim();
			if (fb) storeEntrySummaries(plugin, job, entries, fb);
			else markEpochInputAiSummaryError(plugin, entries, g.inputHash, result.error ?? "(no summary)");
			return;
		}

		const orderedRaw: string[] = [];
		for (let i = 0; i < g.chunkCount; i++) {
			const part = g.summaries.get(i) ?? "";
			if (part.trim()) orderedRaw.push(part.trim());
		}
		const ordered = dedupeOrderedParts(orderedRaw);
		groups.delete(groupIdKey);
		const combined = ordered.join("\n").trim();
		if (!combined) {
			const fb = (g.fallbackText ?? "").trim();
			if (fb) storeEntrySummaries(plugin, job, entries, fb);
			else markEpochInputAiSummaryError(plugin, entries, g.inputHash, result.error ?? "(no summary)");
			return;
		}

		const depth = typeof g.depth === "number" ? g.depth : 0;
		const bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
		if (!bridge) {
			storeEntrySummaries(plugin, job, entries, combined);
			return;
		}

		if (depth >= tuning.reduceMaxDepth) {
			storeEntrySummaries(plugin, job, entries, combined);
			return;
		}

		const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
		const nextDepth = depth + 1;
		const combinedForReduce = dedupeNonEmptyLines(combined) || combined;
		const reduceChunks = dedupeOrderedParts(
			splitIntoAiChunksByLines(combinedForReduce, tuning.maxChunkChars)
				.map(c => dedupeNonEmptyLines(c))
				.filter(c => c && c.trim())
		);
		if (reduceChunks.length === 0) return;

		if (reduceChunks.length === 1) {
			const reduceJobId = mkId();
			getReduceFallbackByJobId(plugin).set(reduceJobId, combined);
			bridge.enqueue([
				{
					id: reduceJobId,
					filePath: job.filePath,
					kind: job.kind,
					date: job.date,
					blockStart: job.blockStart,
					blockEnd: job.blockEnd,
					source: job.source,
					input: reduceChunks[0],
					related: g.related ?? extras.related,
					context: buildReduceContext(job.filePath, representative, nextDepth, String(g.related ?? extras.related ?? "")),
					reduce: true,
					reduceDepth: nextDepth,
					inputHash: job.inputHash,
					createdAt: Date.now(),
					targets: g.targets ?? job.targets,
					groupType: g.groupType ?? job.groupType,
					groupDate: g.groupDate ?? job.groupDate
				}
			]
			);
			return;
		}

		const nextGroupId = mkId();
		groups.set(nextGroupId, {
			filePath: job.filePath,
			kind: job.kind,
			date: job.date,
			blockStart: job.blockStart,
			blockEnd: job.blockEnd,
			source: job.source,
			targets: g.targets ?? job.targets,
			groupType: g.groupType ?? job.groupType,
			groupDate: g.groupDate ?? job.groupDate,
			inputHash: job.inputHash,
			depth: nextDepth,
			chunkCount: reduceChunks.length,
			done: new Set<number>(),
			summaries: new Map<number, string>(),
			fallbackText: combined,
			createdAt: Date.now()
		});
		const reduceJobs: AiSummaryJob[] = [];
		for (let i = 0; i < reduceChunks.length; i++) {
			reduceJobs.push({
				id: mkId(),
				groupId: nextGroupId,
				chunkIndex: i,
				chunkCount: reduceChunks.length,
				filePath: job.filePath,
				kind: job.kind,
				date: job.date,
				blockStart: job.blockStart,
				blockEnd: job.blockEnd,
				source: job.source,
				input: reduceChunks[i],
					related: g.related ?? extras.related,
					context: buildReduceContext(job.filePath, representative, nextDepth, String(g.related ?? extras.related ?? "")),
				reduce: true,
				reduceDepth: nextDepth,
				inputHash: job.inputHash,
				createdAt: Date.now(),
				targets: g.targets ?? job.targets,
				groupType: g.groupType ?? job.groupType,
				groupDate: g.groupDate ?? job.groupDate
			});
		}
		bridge.enqueue(reduceJobs);
	}
}

export function clearResultHandlerState(plugin: EpochPlugin): void {
	try {
		const runtime = getRuntime(plugin);
		runtime.aiBridgeChunkGroups?.clear();
		runtime.aiBridgeReduceFallbackByJobId?.clear();
	} catch { void 0; }
}
