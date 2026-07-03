import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import { isEpochBucket, type EpochBucket } from "../../indexer/types";
import type { AiBridgeServer } from "../ai-bridge";
import { estimateTokens } from "../ai-bridge/tokens";
import { isUserEditingMarkdown } from "../notice-utils";
import { isLikelyTextFilePath } from "../../utils";
import { EPOCH_BUCKET_ORDER, isDateKey, parseDateKey, pickEpochPeriod } from "./shared";
import { buildEpochJobs, buildEpochJobsForDateKeys, type EpochJobMode } from "./epochs";
import { ensureAiBridgeServerRunning, maybeNudgeBridgeNotReady } from "./bridge-server";
import { isGenerateEpochsEffective } from "../pro-feature-state";

type EpochAfterRuntime = {
	__epochAiEnqueueCancelKey?: number;
	epochRegenAfterAiBucketsQueue?: EpochBucket[] | null;
	epochRegenAfterAiShowQueuedNotice?: boolean;
	epochRegenAfterAiMode?: EpochJobMode | null;
	epochRegenAfterAiAll?: boolean;
	epochRegenAfterAiBuckets?: Set<string> | null;
	epochRegenAfterAiDateKeys?: Set<string> | null;
	epochRegenAfterAiTimer?: number | null;
	__epochRegenAfterAiCreatedAt?: number;
	__epochRegenAfterAiLastWaitLogAt?: number;
	__epochRegenAfterAiLastReopenAt?: number;
	__epochEpochHierarchyTotalJobs?: number;
	__epochEpochHierarchyTotalTokens?: number;
	__epochEpochHierarchyRunKey?: number;
	indexer?: {
		index?: Record<string, unknown[]>;
		files?: Record<string, {
			cdate?: { date?: string; file?: string };
			namedDate?: { date?: string; file?: string };
			contentDates?: Array<{ date?: string; file?: string }>;
			trackedDates?: Record<string, Array<{ date?: string; file?: string }>>;
		}>;
	};
	aiBridge?: AiBridgeServer;
	openAiBridgeWindow?: (options?: { silent?: boolean; source?: string; forceOpen?: boolean }) => void;
};

function getAiEnqueueCancelKey(plugin: EpochPlugin): number {
	try {
		const runtime = plugin as unknown as EpochAfterRuntime;
		return Number(runtime.__epochAiEnqueueCancelKey) || 0;
	} catch {
		return 0;
	}
}

function normalizeBucketQueue(raw: EpochBucket[]): EpochBucket[] {
	const out: EpochBucket[] = [];
	const seen = new Set<string>();
	for (const b of raw) {
		const s = String(b || "");
		if (!s || !isEpochBucket(s)) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function mergeBucketQueues(prevRaw: unknown, nextRaw: EpochBucket[]): EpochBucket[] {
	const prev = Array.isArray(prevRaw) ? normalizeBucketQueue(prevRaw as EpochBucket[]) : [];
	const next = normalizeBucketQueue(nextRaw);
	if (prev.length === 0) return next;
	if (next.length === 0) return prev;

	// Preserve the existing queue order to avoid resetting the cascade back to earlier buckets
	// (e.g. repeatedly re-inserting "day" at the head while new work is scheduled).
	// Only append newly requested buckets that are not already queued.
	const out = prev.slice();
	const seen = new Set<string>(prev.map(b => String(b)));
	const nextSet = new Set<string>(next.map(b => String(b)));
	for (const b of EPOCH_BUCKET_ORDER) {
		const key = String(b);
		if (!nextSet.has(key)) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(b);
	}
	return out;
}

export function scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(
	plugin: EpochPlugin,
	dateKeys: string[],
	mode: EpochJobMode,
	bucketQueue: EpochBucket[],
	showQueuedNotice?: boolean
): void {
	const anyPlugin = plugin as unknown as EpochAfterRuntime;
	// IMPORTANT: multiple producers can schedule an after-idle epoch cascade while the timer is already running
	// (e.g. per-entry epoch nudges during AI processing). Do not let later schedules overwrite the existing
	// cascade queue and accidentally drop earlier buckets like "day".
	anyPlugin.epochRegenAfterAiBucketsQueue = mergeBucketQueues(anyPlugin.epochRegenAfterAiBucketsQueue, bucketQueue);
	scheduleEpochRegenerationAfterAiIdleForDateKeys(plugin, dateKeys, mode, undefined, showQueuedNotice);
}

function epochModePriority(mode: EpochJobMode): number {
	if (mode === "force") return 2;
	if (mode === "staleOrMissing") return 1;
	return 0; // missing
}

function mergeEpochMode(prev: EpochJobMode | null | undefined, next: EpochJobMode): EpochJobMode {
	if (!prev) return next;
	return epochModePriority(next) > epochModePriority(prev) ? next : prev;
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
			for (const j of jobs) {
				const input = (j as { input?: unknown }).input;
				totalTokens += estimateTokens(typeof input === "string" ? input : "");
			}
		} catch {
			// ignore
		}
	}

	// See methods-epochs.ts: year epochs may only become buildable after lower buckets exist.
	try {
		const hasYear = buckets.includes("year");
		const hasNonYearBucket = buckets.some((b) => b && b !== "year");
		if (hasYear && hasNonYearBucket && yearJobs === 0 && nonYearJobs > 0) {
			const runtime = plugin as unknown as EpochAfterRuntime;
			const index = runtime.indexer?.index ?? {};
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
					const existing = Array.isArray(index[start]) ? index[start] : [];
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

export function scheduleEpochRegenerationAfterAiIdleForDateKeys(
	plugin: EpochPlugin,
	dateKeys: string[],
	mode: EpochJobMode,
	buckets?: EpochBucket[],
	showQueuedNotice?: boolean
): void {
	const anyPlugin = plugin as unknown as EpochAfterRuntime;
	if (showQueuedNotice === true) {
		anyPlugin.epochRegenAfterAiShowQueuedNotice = true;
	}
	anyPlugin.epochRegenAfterAiMode = mergeEpochMode(anyPlugin.epochRegenAfterAiMode, mode);
	anyPlugin.epochRegenAfterAiAll = anyPlugin.epochRegenAfterAiAll === true ? true : false;
	if (Array.isArray(buckets) && buckets.length > 0) {
		const prev: Set<string> | null = anyPlugin.epochRegenAfterAiBuckets ?? null;
		if (prev == null) {
			anyPlugin.epochRegenAfterAiBuckets = new Set<string>(buckets);
		} else {
			for (const b of buckets) prev.add(String(b));
			anyPlugin.epochRegenAfterAiBuckets = prev;
		}
	}
	const set: Set<string> = anyPlugin.epochRegenAfterAiDateKeys ?? new Set<string>();
	for (const k of dateKeys) {
		if (isDateKey(k)) set.add(k);
	}
	anyPlugin.epochRegenAfterAiDateKeys = set;
	if (anyPlugin.epochRegenAfterAiTimer != null) return;
	anyPlugin.__epochRegenAfterAiCreatedAt = Date.now();
	anyPlugin.__epochRegenAfterAiLastWaitLogAt = 0;
	const startCancelKey = getAiEnqueueCancelKey(plugin);
	anyPlugin.epochRegenAfterAiTimer = window.setInterval(() => {
		void (async () => {
			try {
			const runtime = plugin as unknown as EpochAfterRuntime;
			const isCanceled = (): boolean => getAiEnqueueCancelKey(plugin) !== startCancelKey;
			if (isCanceled()) {
				if (anyPlugin.epochRegenAfterAiTimer != null) {
					window.clearInterval(anyPlugin.epochRegenAfterAiTimer);
					anyPlugin.epochRegenAfterAiTimer = null;
				}
				return;
			}
			let bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
			if (!bridge) {
				await ensureAiBridgeServerRunning(plugin);
				bridge = runtime.aiBridge ?? null;
				if (!bridge) return;
			}
			if (isCanceled()) return;
			const s = bridge.getStatus() as { queued?: number; inProgress?: number; clientConnected?: boolean };
			if ((s.queued ?? 0) > 0 || (s.inProgress ?? 0) > 0) {
				try {
					const now = Date.now();
					const lastAt = Number(anyPlugin.__epochRegenAfterAiLastWaitLogAt ?? 0);
					if (!(lastAt > 0) || now - lastAt > 15000) {
						anyPlugin.__epochRegenAfterAiLastWaitLogAt = now;
						const clientConnected = s.clientConnected === true;

						// If work is queued but no client is connected, try re-opening the bridge page.
						// Throttle this to avoid duplicate tabs.
						if (!clientConnected && Number(s.queued ?? 0) > 0) {
							const lastReopenAt = Number(anyPlugin.__epochRegenAfterAiLastReopenAt ?? 0);
							if (!(lastReopenAt > 0) || (now - lastReopenAt) > 30_000) {
								anyPlugin.__epochRegenAfterAiLastReopenAt = now;
								try {
									void runtime.openAiBridgeWindow?.({ silent: true, source: "auto", forceOpen: true });
								} catch {
									// ignore
								}
							}
						}
					}
				} catch {
					// ignore
				}
				return;
			}
			if (typeof anyPlugin.epochRegenAfterAiTimer === "number") {
				window.clearInterval(anyPlugin.epochRegenAfterAiTimer);
			}
			anyPlugin.epochRegenAfterAiTimer = null;
			const chosen: EpochJobMode = (anyPlugin.epochRegenAfterAiMode as EpochJobMode) ?? "staleOrMissing";
			anyPlugin.epochRegenAfterAiMode = null;
			const regenAll: boolean = anyPlugin.epochRegenAfterAiAll === true;
			anyPlugin.epochRegenAfterAiAll = false;
			const pendingKeys: Set<string> | null = anyPlugin.epochRegenAfterAiDateKeys ?? null;
			anyPlugin.epochRegenAfterAiDateKeys = null;
			const pendingKeysArr = Array.from(pendingKeys ?? []);
			if (!Platform.isDesktop) return;
			if (!isGenerateEpochsEffective(plugin)) return;
			await plugin.ensureIndexLoaded();
			await ensureAiBridgeServerRunning(plugin);
			if (isCanceled()) return;
			const bucketQueueRaw: unknown = anyPlugin.epochRegenAfterAiBucketsQueue;
			const bucketQueue: EpochBucket[] | null = Array.isArray(bucketQueueRaw) ? (bucketQueueRaw as EpochBucket[]) : null;
			const queueHead: EpochBucket | null = bucketQueue && bucketQueue.length > 0 ? bucketQueue[0] : null;
			const queueRest: EpochBucket[] | null = bucketQueue && bucketQueue.length > 1 ? bucketQueue.slice(1) : null;

			// If the caller didn't pre-compute full-hierarchy totals, compute them once now
			// so progress starts with the correct total instead of growing as buckets enqueue.
			try {
				const planned = Number((anyPlugin)?.__epochEpochHierarchyTotalJobs ?? 0);
				if (queueHead && bucketQueue && bucketQueue.length > 1 && !(Number.isFinite(planned) && planned > 0)) {
					const totals = await computeEpochHierarchyTotalsForDateKeys(plugin, pendingKeysArr, chosen, bucketQueue);
					(anyPlugin).__epochEpochHierarchyTotalJobs = totals.totalJobs;
					(anyPlugin).__epochEpochHierarchyTotalTokens = totals.totalTokens;
					(anyPlugin).__epochEpochHierarchyRunKey = (Number((anyPlugin).__epochEpochHierarchyRunKey) || 0) + 1;
				}
			} catch {
				// ignore
			}

			let bucketsList: EpochBucket[] | undefined = undefined;
			if (!regenAll && queueHead) {
				bucketsList = [queueHead];
				anyPlugin.epochRegenAfterAiBucketsQueue = queueRest && queueRest.length > 0 ? queueRest : null;
			} else if (!regenAll) {
				const bucketSet: Set<string> | null = anyPlugin.epochRegenAfterAiBuckets ?? null;
				anyPlugin.epochRegenAfterAiBuckets = null;
				bucketsList = bucketSet ? (Array.from(bucketSet.values()) as unknown as EpochBucket[]) : undefined;
			}

			const jobs = regenAll
				? await buildEpochJobs(plugin, chosen)
				: await buildEpochJobsForDateKeys(plugin, pendingKeysArr, chosen, bucketsList ?? []);
			if (isCanceled()) return;



			// Diagnostics: if the day bucket produces no jobs, log why (sample a few date keys).
			// This helps identify when the aggregated index and/or per-file extracted dates are unexpectedly empty.
			try {
				const bucketName = regenAll
					? "all"
					: (Array.isArray(bucketsList) && bucketsList.length > 0 ? String(bucketsList[0]) : "");
				if (!regenAll && bucketName === "day" && jobs.length === 0 && pendingKeysArr.length > 0) {
					const files = runtime.indexer?.files ?? {};
					const sampleKeys = pendingKeysArr.slice().sort().slice(0, 5);

					const fileCountsByKey = new Map<string, { total: number; likelyText: number }>();
					for (const k of sampleKeys) fileCountsByKey.set(k, { total: 0, likelyText: 0 });
					for (const data of Object.values(files)) {
						const bump = (entry: unknown): void => {
							try {
								const e = entry as { date?: unknown; file?: unknown };
								const d = typeof e.date === "string" ? e.date : "";
								if (!fileCountsByKey.has(d)) return;
								const rec = fileCountsByKey.get(d)!;
								rec.total++;
								const fp = typeof e.file === "string" ? e.file : "";
								if (isLikelyTextFilePath(fp)) rec.likelyText++;
							} catch {
								// ignore
							}
						};
						bump((data)?.cdate);
						bump((data)?.namedDate);
						for (const e of Array.isArray((data)?.contentDates) ? (data).contentDates : []) bump(e);
						const tracked = (data)?.trackedDates ?? {};
						for (const list of Object.values(tracked)) {
							for (const e of Array.isArray(list) ? list : []) bump(e);
						}
					}

				}
			} catch {
				// ignore
			}

			// Enqueue work if needed. Note: for cascaded bucket queues, we must continue
			// to the next bucket even if this bucket had nothing to generate.
			if (jobs.length > 0) {
				const bridge2 = runtime.aiBridge;
				if (!bridge2) return;
				if (isCanceled()) return;
				bridge2.enqueue(jobs);
				if (anyPlugin.epochRegenAfterAiShowQueuedNotice === true) {
					anyPlugin.epochRegenAfterAiShowQueuedNotice = false;
					if (!isUserEditingMarkdown(plugin.app)) {
						new Notice(`Epochs: queued ${jobs.length} job(s).`, 2500);
					}
				}
				maybeNudgeBridgeNotReady(plugin, bridge2);
				if (!bridge2.getStatus().clientConnected) {
					void runtime.openAiBridgeWindow?.({ silent: true });
				}
			}

			// If we're cascading through a bucket hierarchy, schedule the next bucket after AI becomes idle again.
			const remainingQueueRaw: unknown = anyPlugin.epochRegenAfterAiBucketsQueue;
			if (isCanceled()) return;
			if (!regenAll && Array.isArray(remainingQueueRaw) && (remainingQueueRaw as EpochBucket[]).length > 0) {
				scheduleEpochRegenerationAfterAiIdleForDateKeys(plugin, pendingKeysArr, chosen, undefined, false);
			}
			} catch { void 0; }
		})();
	}, 1500);
}

export function scheduleEpochRegenerationAfterAiIdle(plugin: EpochPlugin, mode: EpochJobMode, showQueuedNotice?: boolean): void {
	const anyPlugin = plugin as unknown as EpochAfterRuntime;
	anyPlugin.epochRegenAfterAiAll = true;
	anyPlugin.epochRegenAfterAiMode = mergeEpochMode(anyPlugin.epochRegenAfterAiMode, mode);
	scheduleEpochRegenerationAfterAiIdleForDateKeys(plugin, [], anyPlugin.epochRegenAfterAiMode ?? mode, undefined, showQueuedNotice);
}
