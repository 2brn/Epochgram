import type { EpochPlugin } from "../../main";
import type { DateEntry, EpochBucket } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import { isGenerateEpochsEffective } from "../pro-feature-state";

import { isDateKey, isEpochBucket } from "./shared";
import { formatEpochSummaryForIndex } from "../epoch-summary-format";
import { schedulePersist } from "./persistence";

export function isEpochJob(job: AiSummaryJob): boolean {
	return job?.kind === "epoch";
}

function getLatestEpochJobCreatedAt(plugin: EpochPlugin): Map<string, number> {
	const anyPlugin: any = plugin as any;
	if (!anyPlugin.__epochLatestEpochJobCreatedAt) {
		anyPlugin.__epochLatestEpochJobCreatedAt = new Map<string, number>();
	}
	return anyPlugin.__epochLatestEpochJobCreatedAt as Map<string, number>;
}

function scheduleEpochViewsRefresh(plugin: EpochPlugin): void {
	const anyPlugin: any = plugin as any;
	try {
		if (anyPlugin.__epochEpochEntriesRefreshTimer != null) return;
	} catch {
		// ignore
	}
	const timeoutFn: any = (typeof window !== "undefined" && typeof (window as any).setTimeout === "function")
		? (window as any).setTimeout.bind(window)
		: setTimeout;
	try {
		anyPlugin.__epochEpochEntriesRefreshTimer = timeoutFn(() => {
			try {
				anyPlugin.__epochEpochEntriesRefreshTimer = null;
			} catch {
				// ignore
			}
			try {
				plugin.refreshEpochViews?.();
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

	const summary = formatEpochSummaryForIndex(rawSummary);
	if (!summary) return;
	const bucketRaw = String((job as any).epochBucket || "");
	if (!isEpochBucket(bucketRaw)) return;
	const bucket: EpochBucket = bucketRaw;
	const start = String((job as any).epochStart || "");
	const end = String((job as any).epochEnd || start);
	if (!isDateKey(start)) return;

	const epochFilePath = `epoch://${bucket}/${start}-${end}`;
	const createdAt = typeof (job as any).createdAt === "number" ? (job as any).createdAt : Date.now();
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
		aiSummaryInputHash: (job as any).inputHash
	};

	const indexerAny: any = plugin.indexer as any;
	const index: any = indexerAny.index;
	const list: any[] = Array.isArray(index?.[start]) ? index[start].slice() : [];
	const isEpochFile = (e: any): boolean => String(e?.file ?? "").startsWith("epoch://");
	const filtered = list.filter((e) => {
		if (!e || !isEpochFile(e)) return true;
		return String(e?.file ?? "") !== epochFilePath;
	});
	filtered.push(entry as any);
	index[start] = filtered;
	latestByKey.set(epochFilePath, createdAt);
	scheduleEpochViewsRefresh(plugin);

	schedulePersist(plugin);
	try {
		(plugin as any).scheduleInheritedMarkRecompute?.("epoch");
	} catch {
	}
}
