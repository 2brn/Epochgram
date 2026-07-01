import type { EpochPlugin } from "../../main";
import type { DateEntry, EpochBucket } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import { isGenerateEpochsEffective } from "../pro-feature-state";

import { isDateKey, isEpochBucket } from "./shared";
import { formatEpochSummaryForIndex } from "../epoch-summary-format";
import { schedulePersist } from "./persistence";

type EpochJobLike = AiSummaryJob & {
	epochBucket?: string;
	epochStart?: string;
	epochEnd?: string;
	createdAt?: number;
	inputHash?: string;
};

type EpochStorePluginState = EpochPlugin & {
	__epochLatestEpochJobCreatedAt?: Map<string, number>;
	__epochEpochEntriesRefreshTimer?: number | null;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
	refreshEpochViews?: () => void;
	indexer: {
		index: Record<string, DateEntry[]>;
	};
};

export function isEpochJob(job: AiSummaryJob): boolean {
	return job?.kind === "epoch";
}

function getLatestEpochJobCreatedAt(plugin: EpochPlugin): Map<string, number> {
	const state = plugin as EpochStorePluginState;
	if (!state.__epochLatestEpochJobCreatedAt) {
		state.__epochLatestEpochJobCreatedAt = new Map<string, number>();
	}
	return state.__epochLatestEpochJobCreatedAt;
}

function scheduleEpochViewsRefresh(plugin: EpochPlugin): void {
	const state = plugin as EpochStorePluginState;
	try {
		if (state.__epochEpochEntriesRefreshTimer != null) return;
	} catch {
		// ignore
	}
	if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
	try {
		state.__epochEpochEntriesRefreshTimer = window.setTimeout(() => {
			try {
				state.__epochEpochEntriesRefreshTimer = null;
			} catch {
				// ignore
			}
			try {
				state.refreshEpochViews?.();
			} catch {
				// ignore
			}
		}, 50);
	} catch {
		// ignore
	}
}

export function storeEpochSummary(plugin: EpochPlugin, job: AiSummaryJob, rawSummary: string): void {
	if (!isGenerateEpochsEffective(plugin)) return;
	if (plugin?.hasProAccess?.() !== true) return;
	const state = plugin as EpochStorePluginState;
	const epochJob = job as EpochJobLike;

	const summary = formatEpochSummaryForIndex(rawSummary);
	if (!summary) return;
	const bucketRaw = String(epochJob.epochBucket || "");
	if (!isEpochBucket(bucketRaw)) return;
	const bucket: EpochBucket = bucketRaw;
	const start = String(epochJob.epochStart || "");
	const end = String(epochJob.epochEnd || start);
	if (!isDateKey(start)) return;

	const epochFilePath = `epoch://${bucket}/${start}-${end}`;
	const createdAt = typeof epochJob.createdAt === "number" ? epochJob.createdAt : Date.now();
	const latestByKey = getLatestEpochJobCreatedAt(plugin);
	const prevApplied = latestByKey.get(epochFilePath) ?? 0;
	if (createdAt < prevApplied) {
		return;
	}

	const entry: DateEntry = {
		date: start,
		file: epochFilePath,
		blockStart: 0,
		blockEnd: 0,
		summary,
		source: "epoch",
		epochBucket: bucket,
		epochStart: start,
		epochEnd: end,
		aiSummary: summary,
		aiSummaryInputHash: epochJob.inputHash
	};

	const index = state.indexer.index;
	const list: DateEntry[] = Array.isArray(index?.[start]) ? index[start].slice() : [];
	const isEpochFile = (e: DateEntry): boolean => String(e?.file ?? "").startsWith("epoch://");
	const filtered = list.filter((e) => {
		if (!e || !isEpochFile(e)) return true;
		return String(e?.file ?? "") !== epochFilePath;
	});
	filtered.push(entry);
	index[start] = filtered;
	latestByKey.set(epochFilePath, createdAt);
	scheduleEpochViewsRefresh(plugin);

	schedulePersist(plugin);
	try {
		state.scheduleInheritedMarkRecompute?.("epoch");
	} catch { void 0; }
}
