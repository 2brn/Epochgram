import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { FileDateEntry } from "../../indexer/types";
import type { AiSummaryJob } from "../ai-bridge";
import type { AiBridgeServer } from "../ai-bridge";
import { isLikelyTextFilePath } from "../../utils";
import { buildJobsForFile, getIndexedPathsNewestFirst, sortJobsNewestFirst } from "./file-jobs";
import { getIndexerInternals, resolveTargetEntries } from "./indexer";
import { ensureAiBridgeServerRunning, maybeNudgeBridgeNotReady } from "./bridge-server";
import { enqueueThrottledJobs, isAutoSummarizeEnqueue, shouldApplyEnqueueCooldown } from "./enqueue-throttle";
import { isDateKey } from "./shared";
import { hasSummarizeAIAccess, isSummarizeAIEffective } from "../pro-feature-state";

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
	if (!Platform.isDesktopApp) return;
	if (isAutoSummarizeEnqueue(options) && !isSummarizeAIEffective(this)) return;
	await maybeEnableSummarizeAI(this, options.enableIfDisabled);
	if (!isLikelyTextFilePath(filePath)) return;
	const built = await buildJobsForFile(this, filePath, options.force === true);
	if (built.jobs.length === 0) {
		return;
	}
	const jobs = sortJobsNewestFirst(built.jobs).map((j) => ({ ...(j as any), timelineVisible: true }));
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
	if (!Platform.isDesktopApp) return;
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
	// Synthetic pinned-today entries are clones of the real anchor entry with
	// `date` rewritten to today and `originalDate` set to the real date key.
	// When the user triggers Summarize AI from the pinned-today row, target the
	// underlying real entry date so we can match the built jobs.
	const originalDate = String((entry as any)?.originalDate ?? "");
	const groupDate =
		entry.pinned === true && originalDate && originalDate !== entry.date && isDateKey(originalDate)
			? originalDate
			: entry.date;
	const jobsByTarget = (() => {
		const targetsDate = groupDate;
		const targetsBlockStart = typeof (entry as any)?.blockStart === "number" ? (entry as any).blockStart : null;
		const targetsBlockEnd = typeof (entry as any)?.blockEnd === "number" ? (entry as any).blockEnd : null;
		if (targetsBlockStart == null || targetsBlockEnd == null) return [];
		return built.jobs.filter((j) => {
			const targets = Array.isArray((j as any).targets) ? (j as any).targets : null;
			if (!targets || targets.length === 0) return false;
			return targets.some((t: any) => {
				if (!t) return false;
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
	const sorted = sortJobsNewestFirst(jobs).map((j) => ({ ...(j as any), timelineVisible: true }));
	if (shouldApplyEnqueueCooldown(options)) {
		await enqueueThrottledJobs(this, filePath, sorted, { showNotice: false, allowWhenSummarizeAIDisabled: false });
		return;
	}
	await enqueueThrottledJobs(this, filePath, sorted, { showNotice: options.showNotice, allowWhenSummarizeAIDisabled: true });
}

export async function generateAiSummariesForAllRecords(this: EpochPlugin): Promise<void> {
	if (!hasSummarizeAIAccess(this)) {
		return;
	}
	if (!Platform.isDesktopApp) {
		return;
	}
	// Manual command: allowed regardless of the Summarize AI checkbox.

	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: any) {
		new Notice(`AI summaries error: ${err?.message ?? String(err)}`, 5000);
		return;
	}

	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });
	const cancelKey = Number((this as any).__epochAiEnqueueCancelKey) || 0;
	const isCanceled = (): boolean => (Number((this as any).__epochAiEnqueueCancelKey) || 0) !== cancelKey;
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
	let lastYieldAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	const maybeYield = async () => {
		const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
		if (now - lastYieldAt >= 12) {
			await new Promise((r) => setTimeout(r, 0));
			lastYieldAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
		}
	};
	for (const p of paths) {
		if (checkCanceled()) break;
		iterated++;
		if (!isLikelyTextFilePath(p)) continue;
		if (checkCanceled()) break;
		const built = await buildJobsForFile(this, p, true);
		if (checkCanceled()) break;
		const jobs = sortJobsNewestFirst(built.jobs).map((j) => ({ ...(j as any), timelineVisible: true }));
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
	if (!hasSummarizeAIAccess(this)) {
		return;
	}
	if (!Platform.isDesktopApp) {
		return;
	}
	// Manual command: allowed regardless of the Summarize AI checkbox.

	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: any) {
		new Notice(`AI summaries error: ${err?.message ?? String(err)}`, 5000);
		return;
	}

	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });
	const cancelKey = Number((this as any).__epochAiEnqueueCancelKey) || 0;
	const isCanceled = (): boolean => (Number((this as any).__epochAiEnqueueCancelKey) || 0) !== cancelKey;
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
	let lastYieldAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	const maybeYield = async () => {
		const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
		if (now - lastYieldAt >= 12) {
			await new Promise((r) => setTimeout(r, 0));
			lastYieldAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
		}
	};
	const fileHasMissingAi = (data: any): boolean => {
		const entries: any[] = [];
		if (data?.cdate) entries.push(data.cdate);
		if (data?.namedDate) entries.push(data.namedDate);
		if (data?.dateProp) entries.push(data.dateProp);
		if (Array.isArray(data?.contentDates)) entries.push(...data.contentDates);
		if (data?.trackedDates && typeof data.trackedDates === "object") {
			for (const v of Object.values<any>(data.trackedDates)) {
				if (Array.isArray(v)) entries.push(...v);
			}
		}
		for (const e of entries) {
			const s = typeof e?.aiSummary === "string" ? String(e.aiSummary).trim() : "";
			const h = typeof e?.aiSummaryInputHash === "string" ? String(e.aiSummaryInputHash).trim() : "";
			if (!(s && h)) return true;
		}
		return false;
	};
	for (const p of paths) {
		if (checkCanceled()) break;
		iterated++;
		if (!isLikelyTextFilePath(p)) continue;
		const data = internals?.files?.[p];
		if (data && !fileHasMissingAi(data)) {
			if (iterated % 50 === 0) await maybeYield();
			continue;
		}
		if (checkCanceled()) break;
		const built = await buildJobsForFile(this, p, false);
		if (checkCanceled()) break;
		const onlyMissing = data
			? built.jobs.filter(job => {
				const entries = resolveTargetEntries(data, job);
				if (entries.length === 0) return true;
				return entries.some(e => {
					const anyE: any = e as any;
					const s = typeof anyE.aiSummary === "string" ? anyE.aiSummary.trim() : "";
					const h = typeof anyE.aiSummaryInputHash === "string" ? anyE.aiSummaryInputHash.trim() : "";
					return !(s && h);
				});
			})
			: built.jobs;
		const jobs = sortJobsNewestFirst(onlyMissing).map((j) => ({ ...(j as any), timelineVisible: true }));
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
