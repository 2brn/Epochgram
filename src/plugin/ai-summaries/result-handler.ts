import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { FileDateEntry } from "../../indexer/types";
import { sanitizeSummaryText } from "../../utils";
import type { AiBridgeServer, AiSummaryJob } from "../ai-bridge";
import { buildEpochReduceContext, buildReduceContext } from "./contexts";
import { getIndexerInternals, resolveTargetEntries } from "./indexer";
import { schedulePersist } from "./persistence";
import { AI_REDUCE_MAX_DEPTH, isDateKey, splitIntoAiChunksByLines } from "./shared";
import { isEpochJob, storeEpochSummary } from "./epochs-store";
import { formatAiSummaryOutput } from "../ai-summary-format";
import { clearEpochInputAiSummaryError, markEpochInputAiSummaryError } from "./epoch-input-ai-fallback";
import { isGenerateEpochsEffective, isSummarizeAIEffective } from "../pro-feature-state";

type ChunkGroupState = {
	filePath: string;
	kind: AiSummaryJob["kind"];
	date: string;
	blockStart: number;
	blockEnd: number;
	source: string;
	epochBucket?: string;
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

function getChunkGroups(plugin: EpochPlugin): Map<string, ChunkGroupState> {
	const anyPlugin: any = plugin as any;
	if (!anyPlugin.aiBridgeChunkGroups) {
		anyPlugin.aiBridgeChunkGroups = new Map<string, ChunkGroupState>();
	}
	return anyPlugin.aiBridgeChunkGroups as Map<string, ChunkGroupState>;
}

function getReduceFallbackByJobId(plugin: EpochPlugin): Map<string, string> {
	const anyPlugin: any = plugin as any;
	if (!anyPlugin.aiBridgeReduceFallbackByJobId) {
		anyPlugin.aiBridgeReduceFallbackByJobId = new Map<string, string>();
	}
	return anyPlugin.aiBridgeReduceFallbackByJobId as Map<string, string>;
}

function storeEntrySummaries(plugin: EpochPlugin, job: AiSummaryJob, entries: FileDateEntry[], rawSummary: string): void {
	const finalText = formatAiSummaryOutput(rawSummary);
	if (!finalText) return;
	clearEpochInputAiSummaryError(plugin as any, entries as any[]);
	const explicitVisible = (() => {
		try {
			if (isSummarizeAIEffective(plugin)) return true;
		} catch {
			// ignore
		}
		return (job as any)?.timelineVisible === true;
	})();

	for (const entry of entries) {
		(entry as any).aiSummary = finalText;
		(entry as any).aiSummaryInputHash = job.inputHash;
		(entry as any).aiSummaryVisible = explicitVisible;
	}

	const indexerAny: any = plugin.indexer as any;
	try {
		indexerAny.updateAggregatedEntries(job.filePath);
	} catch {
		// ignore
	}
	schedulePersist(plugin);
	if (explicitVisible) {
		try {
			(plugin as any).queueVectorUpdate?.(job.filePath);
		} catch {
			// ignore
		}
		try {
			(plugin as any).queueTermSimilarityUpdate?.(job.filePath);
		} catch {
			// ignore
		}
	}

	try {
		if (plugin?.hasProAccess?.() && Platform.isDesktopApp && isGenerateEpochsEffective(plugin)) {
			const dateKeys = Array.from(new Set(entries.map((e) => String((e as any)?.date ?? "")).filter(isDateKey)));
			if (dateKeys.length > 0 && typeof (plugin as any).enqueueEpochsForDateKeys === "function") {
				void (plugin as any).enqueueEpochsForDateKeys(dateKeys, { force: false, showNotice: false });
			}
		}
	} catch {
	}
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
		const chunkCountNum = chunkCount as number;
		let g = groups.get(groupIdKey);
		if (!g) {
			g = {
				filePath: job.filePath,
				kind: job.kind,
				date: job.date,
				blockStart: job.blockStart,
				blockEnd: job.blockEnd,
				source: job.source,
				epochBucket: (job as any).epochBucket,
				epochStart: (job as any).epochStart,
				epochEnd: (job as any).epochEnd,
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
			g.epochBucket = (job as any).epochBucket;
			g.epochStart = (job as any).epochStart;
			g.epochEnd = (job as any).epochEnd;
		}
		g.done.add(chunkIndex!);
		if (!hasError && hasUsableSummary) {
			g.summaries.set(chunkIndex!, summary);
		}

		if (g.done.size >= g.chunkCount) {
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
			const bridge: AiBridgeServer | null = (plugin as any).aiBridge ?? null;
			if (!bridge || depth >= AI_REDUCE_MAX_DEPTH) {
				storeEpochSummary(plugin, job, combined);
				return;
			}

			const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
			const nextDepth = depth + 1;
			const combinedForReduce = dedupeNonEmptyLines(combined) || combined;
			const reduceChunks = dedupeOrderedParts(
				splitIntoAiChunksByLines(combinedForReduce)
					.map(c => dedupeNonEmptyLines(c))
					.filter(c => c && c.trim())
			);
			if (reduceChunks.length === 0) return;

			if (reduceChunks.length === 1) {
				const reduceJobId = mkId();
					getReduceFallbackByJobId(plugin).set(reduceJobId, combined);
				const epochBucket = (g.epochBucket ?? (job as any).epochBucket) as any;
				const epochStart = (g.epochStart ?? (job as any).epochStart ?? job.date) as any;
				const epochEnd = (g.epochEnd ?? (job as any).epochEnd ?? epochStart) as any;
				bridge.enqueue([
					{
						id: reduceJobId,
						filePath: job.filePath,
						kind: "epoch",
						date: job.date,
						blockStart: job.blockStart,
						blockEnd: job.blockEnd,
						source: job.source,
						input: reduceChunks[0]!,
						context: buildEpochReduceContext(epochBucket, epochStart, epochEnd),
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
				epochBucket: g.epochBucket ?? (job as any).epochBucket,
				epochStart: g.epochStart ?? (job as any).epochStart,
				epochEnd: g.epochEnd ?? (job as any).epochEnd,
				inputHash: job.inputHash,
				depth: nextDepth,
				chunkCount: reduceChunks.length,
				done: new Set<number>(),
				summaries: new Map<number, string>(),
				fallbackText: combined,
				createdAt: Date.now()
			});
			const epochBucket = (g.epochBucket ?? (job as any).epochBucket) as any;
			const epochStart = (g.epochStart ?? (job as any).epochStart ?? job.date) as any;
			const epochEnd = (g.epochEnd ?? (job as any).epochEnd ?? epochStart) as any;
			const epochReduceContext = buildEpochReduceContext(epochBucket, epochStart, epochEnd);
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
					input: reduceChunks[i]!,
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
	const representative = entries[0]!;

	if (!isChunked) {
		const reduceFallbackByJobId = getReduceFallbackByJobId(plugin);
		const fallback = job.id ? reduceFallbackByJobId.get(job.id) : undefined;
		if (hasError || !hasUsableSummary) {
			if (fallback && fallback.trim()) {
				reduceFallbackByJobId.delete(job.id);
				storeEntrySummaries(plugin, job, entries, fallback);
			}
			else {
				markEpochInputAiSummaryError(plugin as any, entries as any[], job.inputHash, result.error ?? "(no summary)");
			}
			return;
		}
		if (job.id) reduceFallbackByJobId.delete(job.id);
		storeEntrySummaries(plugin, job, entries, summary);
		return;
	}

	const groupIdKey = String(groupId);
	const chunkCountNum = chunkCount as number;
	const chunkIndexNum = chunkIndex as number;

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
			related: (job as any).related,
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
		g.related = (job as any).related;
	}
	g.done.add(chunkIndexNum);
	if (!hasError && hasUsableSummary) {
		g.summaries.set(chunkIndexNum, summary);
	}

	if (g.done.size >= g.chunkCount) {
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
			else markEpochInputAiSummaryError(plugin as any, entries as any[], g.inputHash, result.error ?? "(no summary)");
			return;
		}

		const depth = typeof g.depth === "number" ? g.depth : 0;
		const bridge: AiBridgeServer | null = (plugin as any).aiBridge ?? null;
		if (!bridge) {
			storeEntrySummaries(plugin, job, entries, combined);
			return;
		}

		if (depth >= AI_REDUCE_MAX_DEPTH) {
			storeEntrySummaries(plugin, job, entries, combined);
			return;
		}

		const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
		const nextDepth = depth + 1;
		const combinedForReduce = dedupeNonEmptyLines(combined) || combined;
		const reduceChunks = dedupeOrderedParts(
			splitIntoAiChunksByLines(combinedForReduce)
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
					input: reduceChunks[0]!,
					related: (g.related ?? (job as any).related) as any,
					context: buildReduceContext(job.filePath, representative, nextDepth, String(g.related ?? (job as any).related ?? "")),
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
				input: reduceChunks[i]!,
				related: (g.related ?? (job as any).related) as any,
				context: buildReduceContext(job.filePath, representative, nextDepth, String(g.related ?? (job as any).related ?? "")),
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
		const anyPlugin: any = plugin as any;
		if (anyPlugin.aiBridgeChunkGroups) anyPlugin.aiBridgeChunkGroups.clear();
		if (anyPlugin.aiBridgeReduceFallbackByJobId) anyPlugin.aiBridgeReduceFallbackByJobId.clear();
	} catch {
	}
}
