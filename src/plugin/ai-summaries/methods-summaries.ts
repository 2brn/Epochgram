import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { FileDateEntry, FileIndexData } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import type { AiBridgeServer } from "../ai-bridge";
import { isLikelyTextFilePath } from "../../utils";
import { buildJobsForFile, getIndexedPathsNewestFirst, sortJobsNewestFirst } from "./file-jobs";
import { getIndexerInternals, resolveTargetEntries } from "./indexer";
import { ensureAiBridgeServerRunning, maybeNudgeBridgeNotReady } from "./bridge-server";
import { enqueueThrottledJobs, isAutoSummarizeEnqueue, shouldApplyEnqueueCooldown } from "./enqueue-throttle";
import { isDateKey } from "./shared";
import { hasSummarizeAIAccess, isSummarizeAIEffective } from "../pro-feature-state";

type JobWithVisibility = AiSummaryJob & { timelineVisible: boolean };

type AiSummaryRuntime = {
	aiBridge?: AiBridgeServer;
	__epochAiEnqueueCancelKey?: number;
};

type SummaryEntryLike = {
	aiSummary?: string;
	aiSummaryInputHash?: string;
};

type FileDataLike = {
	cdate?: SummaryEntryLike;
	namedDate?: SummaryEntryLike;
	dateProp?: SummaryEntryLike;
	contentDates?: SummaryEntryLike[];
	trackedDates?: Record<string, SummaryEntryLike[] | undefined>;
};

function nowMs(): number {
	const perf = window.performance;
	if (perf && typeof perf.now === "function") return perf.now();
	return Date.now();
}

type JobTargetLike = {
	date?: string;
	blockStart?: number;
	blockEnd?: number;
	source?: string;
};

function getJobTargets(job: AiSummaryJob): JobTargetLike[] {
	const raw = (job as { targets?: unknown }).targets;
	if (!Array.isArray(raw)) return [];
	return raw as JobTargetLike[];
}

async function maybeEnableSummarizeAI(plugin: EpochPlugin, enableIfDisabled: boolean | undefined): Promise<boolean> {
	// Summarize AI checkbox controls only auto-generation.
	// Manual actions (context menu / commands) are allowed even when unchecked.
	void plugin;
	void enableIfDisabled;
	return true;
}

export async function enqueueAiSummariesForFile(
	this: EpochPlugin,
	filePath: string,
	options: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean } = {}
): Promise<void> {
	if (!hasSummarizeAIAccess(this)) return;
	if (!Platform.isDesktop) return;
	if (isAutoSummarizeEnqueue(options) && !isSummarizeAIEffective(this)) return;
	await maybeEnableSummarizeAI(this, options.enableIfDisabled);
	if (!isLikelyTextFilePath(filePath)) return;
	const built = await buildJobsForFile(this, filePath, options.force === true);
	if (built.jobs.length === 0) {
		return;
	}
	const sortedJobs = sortJobsNewestFirst(built.jobs);
	const jobs: JobWithVisibility[] = sortedJobs.map(j => ({ ...j, timelineVisible: true }));
	if (shouldApplyEnqueueCooldown(options)) {
		await enqueueThrottledJobs(this, filePath, jobs, { showNotice: false, allowWhenSummarizeAIDisabled: false });
		return;
	}
	await enqueueThrottledJobs(this, filePath, jobs, { showNotice: options.showNotice, allowWhenSummarizeAIDisabled: true });
}

export async function enqueueAiSummaryForEntry(
	this: EpochPlugin,
	entry: FileDateEntry,
	options: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean } = {}
): Promise<void> {
	if (!hasSummarizeAIAccess(this)) return;
	if (!Platform.isDesktop) return;
	if (isAutoSummarizeEnqueue(options) && !isSummarizeAIEffective(this)) return;
	await maybeEnableSummarizeAI(this, options.enableIfDisabled);

	const filePath = entry.file;
	if (!isLikelyTextFilePath(filePath)) return;
	const built = await buildJobsForFile(this, filePath, options.force === true);
	if (built.jobs.length === 0) {
		if (options.showNotice && String(built.reason || "").toLowerCase().includes("empty")) {
			new Notice("Note is empty", 2500);
		}
		return;
	}
	const groupType: AiSummaryJob["groupType"] =
		entry.source === "tracked" ? "tracked" :
		(entry.source === "cdate" || entry.source === "namedate" || entry.source === "dateprop") ? "anchor" :
		"content";
	const entryWithOptionalFields = entry as FileDateEntry & {
		originalDate?: string;
		blockStart?: number;
		blockEnd?: number;
	};
	// Synthetic pinned-today entries are clones of the real anchor entry with
	// `date` rewritten to today and `originalDate` set to the real date key.
	// When the user triggers Summarize AI from the pinned-today row, target the
	// underlying real entry date so we can match the built jobs.
	const originalDate = String(entryWithOptionalFields.originalDate ?? "");
	const groupDate =
		entry.pinned === true && originalDate && originalDate !== entry.date && isDateKey(originalDate)
			? originalDate
			: entry.date;
	const jobsByTarget = (() => {
		const targetsDate = groupDate;
		const targetsBlockStart = typeof entryWithOptionalFields.blockStart === "number" ? entryWithOptionalFields.blockStart : null;
		const targetsBlockEnd = typeof entryWithOptionalFields.blockEnd === "number" ? entryWithOptionalFields.blockEnd : null;
		if (targetsBlockStart == null || targetsBlockEnd == null) return [];
		return built.jobs.filter((j) => {
			const targets = getJobTargets(j);
			if (targets.length === 0) return false;
			return targets.some((t) => {
				return (
					String(t.date ?? "") === String(targetsDate) &&
					Number(t.blockStart) === Number(targetsBlockStart) &&
					Number(t.blockEnd) === Number(targetsBlockEnd) &&
					String(t.source ?? "") === String(entry.source ?? "")
				);
			});
		});
	})();
	const jobs = (() => {
		if (jobsByTarget.length) return jobsByTarget;
		const byGroup = built.jobs.filter(j => j.groupType === groupType && j.groupDate === groupDate);
		if (byGroup.length) return byGroup;
		// Filename date-range entries (and other filename-anchored entries) share a single
		// per-file anchor job which targets all anchored entries for the file.
		if (entry.source === "namedate") {
			return built.jobs.filter(j => j.groupType === "anchor");
		}
		return [];
	})();
	if (jobs.length === 0) return;
	const sortedJobs2 = sortJobsNewestFirst(jobs);
	const sorted: JobWithVisibility[] = sortedJobs2.map(j => ({ ...j, timelineVisible: true }));
	if (shouldApplyEnqueueCooldown(options)) {
		await enqueueThrottledJobs(this, filePath, sorted, { showNotice: false, allowWhenSummarizeAIDisabled: false });
		return;
	}
	await enqueueThrottledJobs(this, filePath, sorted, { showNotice: options.showNotice, allowWhenSummarizeAIDisabled: true });
}

export async function generateAiSummariesForAllRecords(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiSummaryRuntime;
	if (!hasSummarizeAIAccess(this)) {
		return;
	}
	if (!Platform.isDesktop) {
		return;
	}
	// Manual command: allowed regardless of the Summarize AI checkbox.

	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		new Notice(`AI summaries error: ${message}`, 5000);
		return;
	}

	const bridge = runtime.aiBridge;
	if (!bridge) return;
	void this.openAiBridgeWindow({ silent: true });
	const cancelKey = Number(runtime.__epochAiEnqueueCancelKey) || 0;
	const isCanceled = (): boolean => (Number(runtime.__epochAiEnqueueCancelKey) || 0) !== cancelKey;
	let canceled = false;
	const checkCanceled = (): boolean => {
		if (!isCanceled()) return false;
		canceled = true;
		return true;
	};
	const internals = getIndexerInternals(this);
	const paths = internals ? getIndexedPathsNewestFirst(this) : [];
	let iterated = 0;
	let totalQueued = 0;
	let lastYieldAt = nowMs();
	const maybeYield = async () => {
		const now = nowMs();
		if (now - lastYieldAt >= 12) {
			await new Promise((r) => window.setTimeout(r, 0));
			lastYieldAt = nowMs();
		}
	};
	for (const p of paths) {
		if (checkCanceled()) break;
		iterated++;
		if (!isLikelyTextFilePath(p)) continue;
		if (checkCanceled()) break;
		const built = await buildJobsForFile(this, p, true);
		if (checkCanceled()) break;
		const sortedJobsA = sortJobsNewestFirst(built.jobs);
		const jobs: JobWithVisibility[] = sortedJobsA.map(j => ({ ...j, timelineVisible: true }));
		if (jobs.length === 0) continue;
		if (checkCanceled()) break;
		bridge.enqueue(jobs);
		totalQueued += jobs.length;
		if (iterated % 25 === 0) {
			await maybeYield();
		}
	}
	if (!canceled && totalQueued > 0) {
		new Notice(`AI summaries: queued ${totalQueued} job(s).`, 2500);
	}
	if (!canceled) {
		maybeNudgeBridgeNotReady(this, bridge);
		if (!bridge.getStatus().clientConnected) {
			void this.openAiBridgeWindow({ silent: true });
		}
	}
}

export async function generateMissingAiSummariesForAllRecords(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiSummaryRuntime;
	if (!hasSummarizeAIAccess(this)) {
		return;
	}
	if (!Platform.isDesktop) {
		return;
	}
	// Manual command: allowed regardless of the Summarize AI checkbox.

	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		new Notice(`AI summaries error: ${message}`, 5000);
		return;
	}

	const bridge = runtime.aiBridge;
	if (!bridge) return;
	void this.openAiBridgeWindow({ silent: true });
	const cancelKey = Number(runtime.__epochAiEnqueueCancelKey) || 0;
	const isCanceled = (): boolean => (Number(runtime.__epochAiEnqueueCancelKey) || 0) !== cancelKey;
	let canceled = false;
	const checkCanceled = (): boolean => {
		if (!isCanceled()) return false;
		canceled = true;
		return true;
	};
	const internals = getIndexerInternals(this);
	const paths = internals ? getIndexedPathsNewestFirst(this) : [];
	let iterated = 0;
	let totalQueued = 0;
	let lastYieldAt = nowMs();
	const maybeYield = async () => {
		const now = nowMs();
		if (now - lastYieldAt >= 12) {
			await new Promise((r) => window.setTimeout(r, 0));
			lastYieldAt = nowMs();
		}
	};
	const fileHasMissingAi = (data: FileDataLike): boolean => {
		const entries: SummaryEntryLike[] = [];
		if (data?.cdate) entries.push(data.cdate);
		if (data?.namedDate) entries.push(data.namedDate);
		if (data?.dateProp) entries.push(data.dateProp);
		if (Array.isArray(data?.contentDates)) entries.push(...data.contentDates);
		if (data?.trackedDates && typeof data.trackedDates === "object") {
			for (const v of Object.values(data.trackedDates)) {
				if (Array.isArray(v)) entries.push(...v);
			}
		}
		for (const e of entries) {
			const s = typeof e.aiSummary === "string" ? e.aiSummary.trim() : "";
			const h = typeof e.aiSummaryInputHash === "string" ? e.aiSummaryInputHash.trim() : "";
			if (!(s && h)) return true;
		}
		return false;
	};
	for (const p of paths) {
		if (checkCanceled()) break;
		iterated++;
		if (!isLikelyTextFilePath(p)) continue;
		const data = internals?.files?.[p] as FileDataLike | undefined;
		if (data && !fileHasMissingAi(data)) {
			if (iterated % 50 === 0) await maybeYield();
			continue;
		}
		if (checkCanceled()) break;
		const built = await buildJobsForFile(this, p, false);
		if (checkCanceled()) break;
		const onlyMissing = data
			? built.jobs.filter(job => {
				const entries = resolveTargetEntries(data as unknown as FileIndexData, job);
				if (entries.length === 0) return true;
				return entries.some(e => {
					const rec = e as SummaryEntryLike;
					const s = typeof rec.aiSummary === "string" ? rec.aiSummary.trim() : "";
					const h = typeof rec.aiSummaryInputHash === "string" ? rec.aiSummaryInputHash.trim() : "";
					return !(s && h);
				});
			})
			: built.jobs;
		const sortedJobsB = sortJobsNewestFirst(onlyMissing);
		const jobs: JobWithVisibility[] = sortedJobsB.map(j => ({ ...j, timelineVisible: true }));
		if (jobs.length === 0) continue;
		if (checkCanceled()) break;
		bridge.enqueue(jobs);
		totalQueued += jobs.length;
		if (iterated % 25 === 0) {
			await maybeYield();
		}
	}
	if (!canceled && totalQueued > 0) {
		new Notice(`AI summaries: queued ${totalQueued} missing job(s).`, 2500);
	}
	if (!canceled) {
		maybeNudgeBridgeNotReady(this, bridge);
		if (!bridge.getStatus().clientConnected) {
			void this.openAiBridgeWindow({ silent: true });
		}
	}
}
