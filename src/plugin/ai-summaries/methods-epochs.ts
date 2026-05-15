import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { EpochBucket } from "../../indexer/types";
import type { AiBridgeServer } from "../ai-bridge";
import { estimateTokens } from "../ai-bridge/tokens";
import { buildEpochJobs, buildEpochJobsForDateKeys, type EpochJobMode } from "./epochs";
import { ensureAiBridgeServerRunning, maybeNudgeBridgeNotReady } from "./bridge-server";
import { scheduleEpochRegenerationAfterAiIdle, scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys } from "./epochs-after-ai";
import { EPOCH_BUCKET_ORDER, isDateKey, parseDateKey, pickEpochPeriod } from "./shared";
import { buildJobsForFile, sortJobsNewestFirst } from "./file-jobs";
import { enqueueThrottledJobs } from "./enqueue-throttle";
import { hasGenerateEpochsAccess, isGenerateEpochsEffective, isSummarizeAIEffective } from "../pro-feature-state";

function getAiEnqueueCancelKey(plugin: EpochPlugin): number {
	try {
		return Number((plugin as any)?.__epochAiEnqueueCancelKey) || 0;
	} catch {
		return 0;
	}
}

function wasAiEnqueueCanceled(plugin: EpochPlugin, startCancelKey: number): boolean {
	return getAiEnqueueCancelKey(plugin) !== startCancelKey;
}

function aiBridgeHasPendingWork(plugin: EpochPlugin): boolean {
	try {
		const bridge: any = (plugin as any).aiBridge;
		if (!bridge || typeof bridge.getStatus !== "function") return false;
		const s: any = bridge.getStatus?.();
		const queued = Number(s?.queued ?? 0);
		const inProgress = Number(s?.inProgress ?? 0);
		return (Number.isFinite(queued) && queued > 0) || (Number.isFinite(inProgress) && inProgress > 0);
	} catch {
		return false;
	}
}

function collectAllEpochDateKeys(plugin: EpochPlugin): string[] {
	const keySet = new Set<string>();
	try {
		const indexerAny: any = (plugin as any)?.indexer as any;
		const index: Record<string, any[]> = indexerAny?.index ?? {};
		const files: Record<string, any> = indexerAny?.files ?? {};

		for (const k of Object.keys(index)) {
			if (isDateKey(k)) keySet.add(k);
		}

		const addEntryDate = (entry: any): void => {
			try {
				const d = String(entry?.date ?? "");
				if (isDateKey(d)) keySet.add(d);
			} catch {
				// ignore
			}
		};
		for (const data of Object.values(files)) {
			try {
				addEntryDate((data as any)?.cdate);
				addEntryDate((data as any)?.namedDate);
				addEntryDate((data as any)?.dateProp);
				for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) addEntryDate(e);
				const tracked = (data as any)?.trackedDates ?? {};
				for (const list of Object.values(tracked)) {
					for (const e of Array.isArray(list) ? list : []) addEntryDate(e);
				}
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
	const dateKeys = Array.from(keySet.values());
	dateKeys.sort();
	return dateKeys;
}

async function enqueueInternalAiSummariesForDateKeys(
	plugin: EpochPlugin,
	dateKeys: string[],
	options: { force?: boolean } = {}
): Promise<number> {
	const startCancelKey = getAiEnqueueCancelKey(plugin);
	const isCanceled = (): boolean => getAiEnqueueCancelKey(plugin) !== startCancelKey;
	const keys = Array.from(new Set((Array.isArray(dateKeys) ? dateKeys : []).map(String).filter(isDateKey)));
	if (keys.length === 0) return 0;
	const keySet = new Set(keys);
	const indexerAny: any = (plugin as any)?.indexer as any;
	const index: Record<string, any[]> = indexerAny?.index ?? {};
	const fileNewestKey = new Map<string, string>();
	const keysNewestFirst = keys.slice().sort().reverse();
	for (const k of keysNewestFirst) {
		const entries = Array.isArray(index[k]) ? index[k]! : [];
		for (const e of entries) {
			const fp = String((e as any)?.file ?? "");
			if (!fp) continue;
			if (fp.startsWith("epoch://")) continue;
			if (!fileNewestKey.has(fp)) fileNewestKey.set(fp, k);
		}
	}
	const files = Array.from(fileNewestKey.entries())
		.sort((a, b) => {
			const ka = a[1];
			const kb = b[1];
			if (ka !== kb) return ka < kb ? 1 : -1;
			const pa = a[0];
			const pb = b[0];
			return pa < pb ? -1 : pa > pb ? 1 : 0;
		})
		.map((x) => x[0]);
	if (files.length === 0) return 0;

	let totalQueued = 0;
	for (const filePath of files) {
		if (isCanceled()) break;
		let built;
		try {
			built = await buildJobsForFile(plugin, filePath, options.force === true);
		} catch {
			continue;
		}
		if (isCanceled()) break;
		const filtered = (built?.jobs ?? []).filter((j: any) => {
			const d = String(j?.groupDate ?? j?.date ?? "");
			return keySet.has(d);
		});
		if (filtered.length === 0) continue;
		const jobs = sortJobsNewestFirst(filtered).map((j) => ({ ...(j as any), timelineVisible: false }));
		try {
			if (isCanceled()) break;
			await enqueueThrottledJobs(plugin, filePath, jobs, { showNotice: false, allowWhenSummarizeAIDisabled: true });
			totalQueued += jobs.length;
		} catch {
			// ignore
		}
	}
	return totalQueued;
}

async function computeEpochHierarchyTotalsForDateKeys(
	plugin: EpochPlugin,
	dateKeys: string[],
	mode: EpochJobMode,
	bucketQueue: EpochBucket[]
): Promise<{ totalJobs: number; totalTokens: number }> {
	let totalJobs = 0;
	let totalTokens = 0;
	let nonYearJobs = 0;
	let yearJobs = 0;
	const buckets = Array.isArray(bucketQueue) ? bucketQueue.filter(Boolean) : [];
	for (const bucket of buckets) {
		try {
			const jobs = await buildEpochJobsForDateKeys(plugin, dateKeys, mode, [bucket]);
			totalJobs += jobs.length;
			if (bucket === "year") yearJobs += jobs.length;
			else nonYearJobs += jobs.length;
			for (const j of jobs) totalTokens += estimateTokens(String((j as any)?.input ?? ""));
		} catch {
			// ignore
		}
	}

	// Special case: year epochs can be "missing" at planning time because their input may
	// only become available after lower-bucket epochs exist (see buildEpochJobsForDateKeys year fallback).
	// When we are cascading multiple buckets and there is lower-bucket work, include the year periods
	// in the planned total up-front so progress denominators don't jump mid-run.
	try {
		const hasYear = buckets.includes("year");
		const hasNonYearBucket = buckets.some((b) => b && b !== "year");
		if (hasYear && hasNonYearBucket && yearJobs === 0 && nonYearJobs > 0) {
			const indexerAny: any = (plugin as any)?.indexer as any;
			const index: Record<string, any[]> = indexerAny?.index ?? {};
			const touched = Array.from(new Set((Array.isArray(dateKeys) ? dateKeys : []).map(String).filter(isDateKey)));
			const yearStarts = new Set<string>();
			for (const k of touched) {
				const d = parseDateKey(k);
				if (!d) continue;
				yearStarts.add(pickEpochPeriod("year", d).start);
			}
			let extraYearJobs = 0;
			for (const start of yearStarts) {
				try {
					const existing = Array.isArray(index[start]) ? index[start]! : [];
					const hasManual = existing.some(() => false);
					if (!hasManual) extraYearJobs++;
				} catch {
					// ignore
				}
			}
			if (extraYearJobs > 0) totalJobs += extraYearJobs;
		}
	} catch {
		// ignore
	}
	return { totalJobs, totalTokens };
}

export async function enqueueEpochsForDateKeys(
	this: EpochPlugin,
	dateKeys: string[],
	options: { force?: boolean; showNotice?: boolean; buckets?: EpochBucket[] } = {}
): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	if (!hasGenerateEpochsAccess(this)) return;
	if (!Platform.isDesktopApp) return;
	if (!isGenerateEpochsEffective(this)) return;
	await this.ensureIndexLoaded();
	const normalizedDateKeys = Array.from(
		new Set((Array.isArray(dateKeys) ? dateKeys : []).map(d => String(d || "")).filter(isDateKey))
	).sort((a, b) => (a === b ? 0 : a < b ? 1 : -1));
	if (normalizedDateKeys.length === 0) return;
	const mode: EpochJobMode = options.force === true ? "force" : "staleOrMissing";
	const bucketQueue = Array.isArray(options.buckets) && options.buckets.length > 0
		? (options.buckets.filter(Boolean) as EpochBucket[])
		: (EPOCH_BUCKET_ORDER.slice() as EpochBucket[]);
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (isGenerateEpochsEffective(this)) {
		try {
			// Force-regenerating epochs should not implicitly force-refresh per-note AI summaries.
			// Per-note summaries are persisted and already re-run automatically when their input hash changes.
			const queued = await enqueueInternalAiSummariesForDateKeys(this, normalizedDateKeys, { force: false });
			if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
			if (queued > 0) {
				if (options.showNotice) {
					let plannedTotal = 0;
					try {
						const totals = await computeEpochHierarchyTotalsForDateKeys(this, normalizedDateKeys, mode, bucketQueue);
						plannedTotal = totals.totalJobs;
						if (plannedTotal > 0) {
							(this as any).__epochEpochHierarchyTotalJobs = totals.totalJobs;
							(this as any).__epochEpochHierarchyTotalTokens = totals.totalTokens;
							(this as any).__epochEpochHierarchyRunKey = (Number((this as any).__epochEpochHierarchyRunKey) || 0) + 1;
						}
					} catch {
						plannedTotal = 0;
					}
					if (plannedTotal > 0) new Notice(`Epochs: queued ${plannedTotal} job(s).`, 2000);
					else new Notice(`Epochs: queued ${queued} input-summary job(s).`, 2000);
				}
				void this.openAiBridgeWindow({ silent: true });
				scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, normalizedDateKeys, mode, bucketQueue, false);
				return;
			}
		} catch {
			// ignore
		}
	}
	const hasPending = aiBridgeHasPendingWork(this);
	if (hasPending) {
		try {
			// For cascaded bucket runs, compute the total across the full hierarchy so the
			// status bar and bridge page can show overall remaining epochs (not just the first bucket).
			// Sum per-bucket to avoid building the full hierarchy in one call.
			if (bucketQueue.length > 1) {
				const planned = Number((this as any).__epochEpochHierarchyTotalJobs ?? 0);
				if (!(Number.isFinite(planned) && planned > 0)) {
					const totals = await computeEpochHierarchyTotalsForDateKeys(this, normalizedDateKeys, mode, bucketQueue);
					(this as any).__epochEpochHierarchyTotalJobs = totals.totalJobs;
					(this as any).__epochEpochHierarchyTotalTokens = totals.totalTokens;
					(this as any).__epochEpochHierarchyRunKey = (Number((this as any).__epochEpochHierarchyRunKey) || 0) + 1;
				}
			}
		} catch {
			// ignore
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		const shouldShow = options.showNotice === true;
		let queuedCount = 0;
		if (shouldShow) {
			try {
				if (bucketQueue.length > 1) {
					queuedCount = (await computeEpochHierarchyTotalsForDateKeys(this, normalizedDateKeys, mode, bucketQueue)).totalJobs;
				} else {
					const jobs = await buildEpochJobsForDateKeys(this, normalizedDateKeys, mode, [bucketQueue[0]!]);
					queuedCount = jobs.length;
				}
			} catch {
				queuedCount = 0;
			}
			if (wasAiEnqueueCanceled(this, startCancelKey)) return;
			if (queuedCount > 0) new Notice(`Epochs: queued ${queuedCount} job(s).`, 2000);
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		void this.openAiBridgeWindow({ silent: true });
		// Always schedule regeneration after idle when the caller explicitly asked
		// for epoch generation. The queuedCount is best-effort for the notice only;
		// it must not suppress the actual regeneration (it may be 0 if the index is
		// still warming up or job building failed for the notice).
		// Do not propagate showNotice into the after-idle scheduler; otherwise the user
		// sees a second "Epochs: queued ..." notice when the deferred work actually enqueues.
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, normalizedDateKeys, mode, bucketQueue, false);
		return;
	}

	try {
		await ensureAiBridgeServerRunning(this);
	} catch {
		return;
	}
	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (bucketQueue.length > 1) {
		const first = bucketQueue[0]!;
		const rest = bucketQueue.slice(1);
		try {
			const planned = Number((this as any).__epochEpochHierarchyTotalJobs ?? 0);
			if (!(Number.isFinite(planned) && planned > 0)) {
				const totals = await computeEpochHierarchyTotalsForDateKeys(this, normalizedDateKeys, mode, bucketQueue);
				(this as any).__epochEpochHierarchyTotalJobs = totals.totalJobs;
				(this as any).__epochEpochHierarchyTotalTokens = totals.totalTokens;
				(this as any).__epochEpochHierarchyRunKey = (Number((this as any).__epochEpochHierarchyRunKey) || 0) + 1;
			}
		} catch {
			// ignore
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		const firstJobs = await buildEpochJobsForDateKeys(this, normalizedDateKeys, mode, [first]);
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		if (firstJobs.length > 0) {
			bridge.enqueue(firstJobs);
		}
		// Schedule remaining buckets to run after each prior bucket completes.
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, normalizedDateKeys, mode, rest, false);
		if (options.showNotice) {
			const plannedTotal = Number((this as any).__epochEpochHierarchyTotalJobs ?? 0);
			const count = Number.isFinite(plannedTotal) && plannedTotal > 0 ? plannedTotal : firstJobs.length;
			new Notice(`Epochs: queued ${count} job(s).`, 2000);
		}
		maybeNudgeBridgeNotReady(this, bridge);
		if (!bridge.getStatus().clientConnected) {
			void this.openAiBridgeWindow({ silent: true });
		}
		return;
	}
	const jobs = await buildEpochJobsForDateKeys(this, normalizedDateKeys, mode, options.buckets);
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (jobs.length === 0) {
		return;
	}
	bridge.enqueue(jobs);
	if (options.showNotice) {
		new Notice(`Epochs: queued ${jobs.length} job(s).`, 2000);
	}
	maybeNudgeBridgeNotReady(this, bridge);
	if (!bridge.getStatus().clientConnected) {
		void this.openAiBridgeWindow({ silent: true });
	}
}

export async function generateEpochsForAllRecords(this: EpochPlugin): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	if (!hasGenerateEpochsAccess(this)) return;
	if (!Platform.isDesktopApp) return;
	if (!isGenerateEpochsEffective(this)) return;
	await this.ensureIndexLoaded();
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (isGenerateEpochsEffective(this)) {
		try {
			const dateKeys = collectAllEpochDateKeys(this);
			const queued = await enqueueInternalAiSummariesForDateKeys(this, dateKeys, { force: false });
			if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
			if (queued > 0) {
				void this.openAiBridgeWindow({ silent: true });
				scheduleEpochRegenerationAfterAiIdle(this, "staleOrMissing", false);
				let planned = 0;
				try {
					planned = (await buildEpochJobs(this, "staleOrMissing")).length;
				} catch {
					planned = 0;
				}
				if (planned > 0) {
					new Notice(`Epochs: scheduled ${planned} job(s) (queued ${queued} summary job(s)).`, 2500);
				} else {
					new Notice(`Epochs: queued ${queued} summary job(s).`, 2500);
				}
				return;
			}
		} catch {
			// ignore
		}
	}
	if (isSummarizeAIEffective(this) && aiBridgeHasPendingWork(this)) {
		const shouldShow = true;
		let queuedCount = 0;
		if (shouldShow) {
			try {
				const jobs = await buildEpochJobs(this, "staleOrMissing");
				queuedCount = jobs.length;
			} catch {
				queuedCount = 0;
			}
			if (wasAiEnqueueCanceled(this, startCancelKey)) return;
			if (queuedCount > 0) new Notice(`Epochs: queued ${queuedCount} job(s).`, 2000);
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		void this.openAiBridgeWindow({ silent: true });
		if (queuedCount > 0 || !shouldShow) {
			scheduleEpochRegenerationAfterAiIdle(this, "staleOrMissing", false);
		}
		return;
	}
	await ensureAiBridgeServerRunning(this);
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });
	const jobs = await buildEpochJobs(this, "staleOrMissing");
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (jobs.length === 0) {
		return;
	}
	bridge.enqueue(jobs);
	new Notice(`Epochs: queued ${jobs.length} job(s).`, 2000);
	if (!bridge.getStatus().clientConnected) {
		void this.openAiBridgeWindow({ silent: true });
	}
}

export async function regenerateEpochsForAllRecords(this: EpochPlugin): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	if (!hasGenerateEpochsAccess(this)) {
		new Notice(`Epochgram ${"Pro"} required: ${"Generate Epochs"}`, 5000);
		return;
	}
	if (!Platform.isDesktopApp) {
		new Notice(`Generate ${"Epochs"} is desktop-only`, 5000);
		return;
	}
	if (!isGenerateEpochsEffective(this)) {
		new Notice(`Enable ${"Generate Epochs"} in settings first`, 5000);
		return;
	}
	if (isGenerateEpochsEffective(this)) {
		await this.ensureIndexLoaded();
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		try {
			const dateKeys = collectAllEpochDateKeys(this);
			const queued = await enqueueInternalAiSummariesForDateKeys(this, dateKeys, { force: true });
			if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
			if (queued > 0) {
				void this.openAiBridgeWindow({ silent: true });
				scheduleEpochRegenerationAfterAiIdle(this, "force", false);
				let planned = 0;
				try {
					planned = (await buildEpochJobs(this, "force")).length;
				} catch {
					planned = 0;
				}
				if (planned > 0) {
					new Notice(`Epochs: scheduled ${planned} job(s).`, 2500);
				} else {
					new Notice(`Epochs: queued ${queued} summary job(s).`, 2500);
				}
				return;
			}
		} catch {
			// ignore
		}
	}
	if (isSummarizeAIEffective(this) && aiBridgeHasPendingWork(this)) {
		await this.ensureIndexLoaded();
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		const shouldShow = true;
		let queuedCount = 0;
		if (shouldShow) {
			try {
				const jobs = await buildEpochJobs(this, "force");
				queuedCount = jobs.length;
			} catch {
				queuedCount = 0;
			}
			if (wasAiEnqueueCanceled(this, startCancelKey)) return;
			if (queuedCount > 0) new Notice(`Epochs: queued ${queuedCount} job(s).`, 2000);
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		void this.openAiBridgeWindow({ silent: true });
		if (queuedCount > 0 || !shouldShow) {
			scheduleEpochRegenerationAfterAiIdle(this, "force", false);
		}
		return;
	}
	await this.ensureIndexLoaded();
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: any) {
		new Notice(`Epochs error: ${err?.message ?? String(err)}`, 5000);
		return;
	}
	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });
	const jobs = await buildEpochJobs(this, "force");
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	if (jobs.length === 0) {
		return;
	}
	bridge.enqueue(jobs);
	new Notice(`Epochs: queued ${jobs.length} job(s).`, 2500);
	maybeNudgeBridgeNotReady(this, bridge);
	if (!bridge.getStatus().clientConnected) {
		void this.openAiBridgeWindow({ silent: true });
	}
}

export async function regenerateMissingEpochsForAllRecords(this: EpochPlugin): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	if (!hasGenerateEpochsAccess(this)) {
		new Notice(`Epochgram ${"Pro"} required: ${"Generate Epochs"}`, 5000);
		return;
	}
	if (!Platform.isDesktopApp) {
		new Notice(`Generate ${"Epochs"} is desktop-only`, 5000);
		return;
	}
	if (!isGenerateEpochsEffective(this)) {
		new Notice(`Enable ${"Generate Epochs"} in settings first`, 5000);
		return;
	}
	await this.ensureIndexLoaded();
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;
	const dateKeys = collectAllEpochDateKeys(this);
	if (dateKeys.length === 0) {
		return;
	}
	if (isGenerateEpochsEffective(this)) {
		try {
			const queued = await enqueueInternalAiSummariesForDateKeys(this, dateKeys, { force: false });
			if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
			if (queued > 0) {
				void this.openAiBridgeWindow({ silent: true });
				scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, dateKeys, "missing", EPOCH_BUCKET_ORDER.slice() as EpochBucket[], false);
				let planned = 0;
				try {
					planned = (await computeEpochHierarchyTotalsForDateKeys(this, dateKeys, "missing", EPOCH_BUCKET_ORDER.slice() as EpochBucket[])).totalJobs;
				} catch {
					planned = 0;
				}
				if (planned > 0) {
					new Notice(`Epochs: queued ${queued} summary job(s).`, 2500);
				} else {
					new Notice(`Epochs: queued ${queued} summary job(s).`, 2500);
				}
				return;
			}
		} catch {
			// ignore
		}
	}

	const bucketQueue = EPOCH_BUCKET_ORDER.slice() as EpochBucket[];
	const mode: EpochJobMode = "missing";

	const hasPending = aiBridgeHasPendingWork(this);
	if (hasPending) {
		const shouldShow = true;
		let queuedCount = 0;
		if (shouldShow) {
			try {
				queuedCount = (await computeEpochHierarchyTotalsForDateKeys(this, dateKeys, mode, bucketQueue)).totalJobs;
			} catch {
				queuedCount = 0;
			}
			if (wasAiEnqueueCanceled(this, startCancelKey)) return;
			if (queuedCount > 0) new Notice(`Epochs: queued ${queuedCount} missing job(s).`, 2000);
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		void this.openAiBridgeWindow({ silent: true });
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, dateKeys, mode, bucketQueue, false);
		return;
	}

	try {
		await ensureAiBridgeServerRunning(this);
	} catch (err: any) {
		new Notice(`Epochs error: ${err?.message ?? String(err)}`, 5000);
		return;
	}
	const bridge: AiBridgeServer = (this as any).aiBridge;
	void this.openAiBridgeWindow({ silent: true });

	try {
		const totals = await computeEpochHierarchyTotalsForDateKeys(this, dateKeys, mode, bucketQueue);
		(this as any).__epochEpochHierarchyTotalJobs = totals.totalJobs;
		(this as any).__epochEpochHierarchyTotalTokens = totals.totalTokens;
		(this as any).__epochEpochHierarchyRunKey = (Number((this as any).__epochEpochHierarchyRunKey) || 0) + 1;
	} catch {
		// ignore
	}
	if (wasAiEnqueueCanceled(this, startCancelKey)) return;

	let firstNonEmptyJobs: any[] = [];
	let firstNonEmptyIndex = -1;
	for (let i = 0; i < bucketQueue.length; i++) {
		const bucket = bucketQueue[i]!;
		let jobsForBucket: any[] = [];
		try {
			jobsForBucket = await buildEpochJobsForDateKeys(this, dateKeys, mode, [bucket]);
		} catch {
			jobsForBucket = [];
		}
		if (wasAiEnqueueCanceled(this, startCancelKey)) return;
		if (jobsForBucket.length === 0) continue;
		firstNonEmptyJobs = jobsForBucket;
		firstNonEmptyIndex = i;
		break;
	}
	if (firstNonEmptyJobs.length === 0) {
		return;
	}
	bridge.enqueue(firstNonEmptyJobs as any);
	// Cascade only buckets that come after the first non-empty one we just enqueued.
	const rest = bucketQueue.slice(firstNonEmptyIndex + 1);
	if (rest.length > 0) {
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(this, dateKeys, mode, rest, false);
	}
	{
		const plannedTotal = Number((this as any).__epochEpochHierarchyTotalJobs ?? 0);
		const count = Number.isFinite(plannedTotal) && plannedTotal > 0 ? plannedTotal : firstNonEmptyJobs.length;
		new Notice(`Epochs: queued ${count} missing job(s).`, 2500);
	}
	maybeNudgeBridgeNotReady(this, bridge);
	if (!bridge.getStatus().clientConnected) {
		void this.openAiBridgeWindow({ silent: true });
	}
}
