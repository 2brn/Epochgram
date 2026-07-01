import { Notice, Platform, TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import { computeAiSummaryInputHash } from "../../utils";
import { isUserEditingMarkdown } from "../notice-utils";
import { announceEpochDesktopTaskAfter, cancelEpochDesktopTaskAnnouncement, clearEpochProgress, consumeCancelRequested, setEpochProgress } from "../progress";
import { ensureTermStoreFileExists, readTermStore, writeTermStore } from "../similarity-term-store";
import { isSimilarityEnabled, isTopicSimilarityEnabled } from "./config";
import { debugLog, devConsoleWarnOnce } from "./debug";
import { pickNewestPendingPath } from "./files";
import { shouldAllowSimilarityProgressNotice, shouldShowTermSimilarityUpdateNotice } from "./notice";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { now } from "./time";
import { buildZeroShotCandidateText } from "./text";
import { getSimilarityWorker } from "./worker-factory";
import { loadZeroShotModelViaWorker, zeroShotScoreLabelsViaWorker } from "./worker-zeroshot";
import { hasSimilarityAccess } from "../pro-feature-state";

type TermStore = Awaited<ReturnType<typeof readTermStore>>;

type TopicQueuePluginRuntime = EpochPlugin & {
	termSimilarityQueueRunning?: boolean;
	termSimilarityQueueTimer?: number | null;
	termSimilarityEnsureTimer?: number | null;
	termSimilarityResetKey?: number;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	termSimilarityStartedAt?: number;
	termSimilarityStoreCache?: TermStore | null;
	termSimilarityStoreDirtyUpdates?: number;
	termSimilarityStoreLastWriteAt?: number;
	termSimilarityWorkerLastLoadError?: string;
	termSimilarityProcessingStartedAt?: number;
	shouldIndexFile?: (file: TFile) => boolean;
};

export function scheduleProcessPendingTermSimilarityQueue(plugin: EpochPlugin, delayMs: number = 0): void {
	const anyPlugin = plugin as TopicQueuePluginRuntime;
	if (anyPlugin.termSimilarityQueueRunning) return;
	if (anyPlugin.termSimilarityQueueTimer) return;
	const MIN_DELAY_MS = 150;
	const delay = Math.max(MIN_DELAY_MS, Math.floor(delayMs));
	anyPlugin.termSimilarityQueueTimer = window.setTimeout(() => {
		anyPlugin.termSimilarityQueueTimer = null;
		void processPendingTermSimilarityQueue(plugin);
	}, delay);
}

export function ensureTermStoreExistsSoon(plugin: EpochPlugin): void {
	const anyPlugin = plugin as TopicQueuePluginRuntime;
	if (anyPlugin.termSimilarityEnsureTimer) return;
	anyPlugin.termSimilarityEnsureTimer = window.setTimeout(() => {
		anyPlugin.termSimilarityEnsureTimer = null;
		void ensureTermStoreFileExists(plugin).catch(() => {
			// ignore
		});
	}, 200);
}

export async function processPendingTermSimilarityQueue(plugin: EpochPlugin): Promise<void> {
	const anyPlugin = plugin as TopicQueuePluginRuntime;
	if (anyPlugin.termSimilarityQueueRunning) return;
	const resetKeyAtStart = (() => {
		try {
			const v = Number(anyPlugin.termSimilarityResetKey ?? 0);
			return Number.isFinite(v) ? v : 0;
		} catch {
			return 0;
		}
	})();

	let getStoreFromCache: () => Promise<TermStore> = async () => await readTermStore(plugin);
	let bumpDirty: () => void = () => {};
	let maybeFlushStore: (force: boolean) => Promise<void> = async () => {};
	try {
		if (Platform.isDesktopApp && consumeCancelRequested(plugin, "topics")) {
			anyPlugin.termSimilarityPendingFiles = new Set<string>();
			anyPlugin.termSimilarityQueueTotal = 0;
			anyPlugin.termSimilarityQueueProcessed = 0;
			try {
				anyPlugin.termSimilarityStartedAt = 0;
			} catch {
				// ignore
			}
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (typeof anyPlugin.termSimilarityStartedAt !== "number" || !(anyPlugin.termSimilarityStartedAt > 0)) {
			anyPlugin.termSimilarityStartedAt = now();
			try {
				anyPlugin.termSimilarityQueueProcessed = 0;
				anyPlugin.termSimilarityQueueTotal = 0;
			} catch {
				// ignore
			}
			if (Platform.isDesktopApp) {
				announceEpochDesktopTaskAfter(plugin, "topics:queued", "Topics queued", {
					graceMs: 1000,
					minIntervalMs: 1000,
					still: () => {
						try {
							const p = plugin as TopicQueuePluginRuntime;
							const startedAt = Number(p.termSimilarityStartedAt ?? 0);
							if (!(Number.isFinite(startedAt) && startedAt > 0)) return false;
							const pending = p.termSimilarityPendingFiles;
							const hasPending = pending instanceof Set && pending.size > 0;
							return p.termSimilarityQueueRunning === true || hasPending;
						} catch {
							return true;
						}
					}
				});
			}
		}
	} catch {
		// ignore
	}
	anyPlugin.termSimilarityQueueRunning = true;
	try {
		if (!hasSimilarityAccess(plugin)) return;
		if (!isSimilarityEnabled(plugin)) return;
		if (!isTopicSimilarityEnabled(plugin)) return;
		const w = getSimilarityWorker(plugin);
		if (!w) return;
		if (!(anyPlugin.termSimilarityPendingFiles instanceof Set)) {
			anyPlugin.termSimilarityPendingFiles = new Set<string>();
		}
		const pendingFiles = anyPlugin.termSimilarityPendingFiles;
		if (pendingFiles.size === 0) return;

		// Hard guard: topic classification is markdown-only.
		try {
			const pending = pendingFiles;
			if (pending instanceof Set && pending.size > 0) {
				for (const p of Array.from(pending)) {
					const s = String(p || "");
					if (!s || s.startsWith("epoch://") || !/\.md$/i.test(s)) {
						pending.delete(p);
						try {
							anyPlugin.termSimilarityPendingFiles?.delete(p);
						} catch {
							// ignore
						}
					}
				}
			}
		} catch {
			// ignore
		}

		const WRITE_EVERY_N_UPDATES = 10;
		const WRITE_MAX_INTERVAL_MS = 15_000;
		getStoreFromCache = async () => {
			const cached = anyPlugin.termSimilarityStoreCache;
			if (cached && typeof cached === "object" && cached.files && typeof cached.files === "object") return cached;
			const loaded = await readTermStore(plugin);
			anyPlugin.termSimilarityStoreCache = loaded;
			return loaded;
		};
		bumpDirty = () => {
			anyPlugin.termSimilarityStoreDirtyUpdates =
				(typeof anyPlugin.termSimilarityStoreDirtyUpdates === "number" ? anyPlugin.termSimilarityStoreDirtyUpdates : 0) + 1;
		};
		maybeFlushStore = async (force: boolean) => {
			try {
				const currentKeyRaw = Number(anyPlugin.termSimilarityResetKey ?? 0);
				const currentKey = Number.isFinite(currentKeyRaw) ? currentKeyRaw : 0;
				if (currentKey !== resetKeyAtStart) {
					anyPlugin.termSimilarityStoreCache = null;
					anyPlugin.termSimilarityStoreDirtyUpdates = 0;
					anyPlugin.termSimilarityStoreLastWriteAt = 0;
					return;
				}
			} catch {
				// ignore
			}
			const store = anyPlugin.termSimilarityStoreCache;
			if (!store || typeof store !== "object") return;
			const dirty = typeof anyPlugin.termSimilarityStoreDirtyUpdates === "number" ? anyPlugin.termSimilarityStoreDirtyUpdates : 0;
			if (dirty <= 0) return;
			const lastWriteAt = typeof anyPlugin.termSimilarityStoreLastWriteAt === "number" ? anyPlugin.termSimilarityStoreLastWriteAt : 0;
			if (!force) {
				const elapsed = now() - lastWriteAt;
				if (dirty < WRITE_EVERY_N_UPDATES && elapsed < WRITE_MAX_INTERVAL_MS) return;
			}
			try {
				await writeTermStore(plugin, store);
				anyPlugin.termSimilarityStoreDirtyUpdates = 0;
				anyPlugin.termSimilarityStoreLastWriteAt = now();
			} catch {
				// ignore
			}
		};

		anyPlugin.termSimilarityQueueProcessed = typeof anyPlugin.termSimilarityQueueProcessed === "number" ? Math.max(0, anyPlugin.termSimilarityQueueProcessed) : 0;
		const prevProcessed = anyPlugin.termSimilarityQueueProcessed;
		anyPlugin.termSimilarityQueueTotal = Math.max(1, prevProcessed + pendingFiles.size);

		const vocab = getTermVocabulary(plugin);
		if (vocab.terms.length > 0) {
			const loaded = await loadZeroShotModelViaWorker(plugin);
			if (!loaded) {
				try {
					const lastErr = String(anyPlugin.termSimilarityWorkerLastLoadError ?? "").trim();
					if (lastErr) {
						devConsoleWarnOnce(plugin, "term-similarity-load", `[epoch] zero-shot model unavailable: ${lastErr}`);
					}
				} catch {
					// ignore
				}
				return;
			}
		}
		try {
			if (Platform.isDesktopApp && consumeCancelRequested(plugin, "topics")) {
				anyPlugin.termSimilarityPendingFiles = new Set<string>();
				anyPlugin.termSimilarityQueueTotal = 0;
				anyPlugin.termSimilarityQueueProcessed = 0;
				try {
					anyPlugin.termSimilarityStartedAt = 0;
				} catch {
					// ignore
				}
				return;
			}
		} catch {
			// ignore
		}
		const nextPath = pickNewestPendingPath(plugin, pendingFiles);
		if (!nextPath) return;
		try {
			if (
				typeof anyPlugin.termSimilarityProcessingStartedAt !== "number" ||
				!(anyPlugin.termSimilarityProcessingStartedAt > 0)
			) {
				anyPlugin.termSimilarityProcessingStartedAt = now();
			}
		} catch {
			// ignore
		}
		pendingFiles.delete(nextPath);
		anyPlugin.termSimilarityQueueProcessed =
			(typeof anyPlugin.termSimilarityQueueProcessed === "number" ? anyPlugin.termSimilarityQueueProcessed : 0) + 1;
		anyPlugin.termSimilarityQueueTotal = Math.max(1, anyPlugin.termSimilarityQueueProcessed + pendingFiles.size);
		const file = plugin.app.vault.getAbstractFileByPath(nextPath);
		if (!(file instanceof TFile)) return;
		if ((file.extension || "").toLowerCase() !== "md") return;

		try {
			// If the file has an explicit embedding term (or explicitly disables topics),
			// term inference cannot affect behavior; skip work and delete any stale inferred record.
			try {
				const explicit = getEmbeddingTermForPath(plugin, file.path);
				if (explicit) {
					const store = await getStoreFromCache();
					if (store.files && store.files[file.path]) {
						delete store.files[file.path];
						bumpDirty();
						await maybeFlushStore(false);
					}
					return;
				}
			} catch {
				// ignore
			}

			if (!anyPlugin.shouldIndexFile?.(file)) {
				const store = await getStoreFromCache();
				if (store.files[file.path]) {
					delete store.files[file.path];
					bumpDirty();
					await maybeFlushStore(false);
				}
				return;
			}

			if (vocab.terms.length === 0) {
				const store = await getStoreFromCache();
				if (store.files[file.path]) {
					delete store.files[file.path];
					bumpDirty();
					await maybeFlushStore(false);
				}
				return;
			}

			const sequence = await buildZeroShotCandidateText(plugin, file);
			if (!sequence) return;
			const contentHash = computeAiSummaryInputHash(file.path, "topic", sequence, 1000);
			const store = await getStoreFromCache();
			const existing = store.files[file.path];
			if (existing && existing.h === contentHash && existing.vocabularySig === vocab.sig) {
				return;
			}

			const scored = await zeroShotScoreLabelsViaWorker(plugin, vocab.terms, sequence);
			if (!scored || scored.labels.length === 0 || scored.scores.length === 0) {
				return;
			}
			let bestLabel = "";
			let bestScore = 0;
			for (let i = 0; i < scored.labels.length && i < scored.scores.length; i++) {
				const s = Number(scored.scores[i]);
				if (!Number.isFinite(s)) continue;
				if (s > bestScore) {
					bestScore = s;
					bestLabel = scored.labels[i] || "";
				}
			}
			bestLabel = String(bestLabel || "").trim();
			if (!bestLabel) {
				if (store.files[file.path]) {
					delete store.files[file.path];
					bumpDirty();
					await maybeFlushStore(false);
				}
				return;
			}
			store.files[file.path] = {
				term: bestLabel,
				score: Math.max(0, Math.min(1, Number(bestScore) || 0)),
				h: contentHash,
				vocabularySig: vocab.sig,
				updatedAt: now()
			};
			bumpDirty();
			await maybeFlushStore(false);
		} finally {
			try {
				if (shouldShowTermSimilarityUpdateNotice(plugin) && !isUserEditingMarkdown(plugin.app)) {
					const done = typeof anyPlugin.termSimilarityQueueProcessed === "number" ? anyPlugin.termSimilarityQueueProcessed : 0;
					const tot = typeof anyPlugin.termSimilarityQueueTotal === "number" ? anyPlugin.termSimilarityQueueTotal : 0;
					if (vocab.terms.length > 0 && shouldAllowSimilarityProgressNotice(plugin, "termSimilarityProcessingStartedAt")) {
						if (Platform.isDesktopApp) {
							setEpochProgress(plugin, "topics", `Topics… ${done}/${Math.max(done, tot)}`);
						} else {
							new Notice(`Topics… ${done}/${Math.max(done, tot)}`, 900);
						}
					}
				}
			} catch {
				// ignore
			}
		}
	} catch (e: unknown) {
		const err = e instanceof Error
			? e.message
			: (typeof e === "string" || typeof e === "number" || typeof e === "boolean")
				? String(e)
				: "failed";
		debugLog("termSimilarity:queue-failed", { err });
	} finally {
		try {
			const pending = anyPlugin.termSimilarityPendingFiles?.size ?? 0;
			if (pending <= 0) {
				await maybeFlushStore(true);
				anyPlugin.termSimilarityStoreCache = null;
				anyPlugin.termSimilarityStoreDirtyUpdates = 0;
			}
		} catch {
			// ignore
		}
		anyPlugin.termSimilarityQueueRunning = false;
		if (!anyPlugin.termSimilarityPendingFiles || anyPlugin.termSimilarityPendingFiles.size === 0) {
			anyPlugin.termSimilarityQueueTotal = 0;
			anyPlugin.termSimilarityQueueProcessed = 0;
			try {
				anyPlugin.termSimilarityStartedAt = 0;
				anyPlugin.termSimilarityProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				if (Platform.isDesktopApp) {
					cancelEpochDesktopTaskAnnouncement(plugin, "topics:queued");
					clearEpochProgress(plugin, "topics", 1500);
				}
			} catch {
				// ignore
			}
		}
		try {
			if (anyPlugin.termSimilarityPendingFiles && anyPlugin.termSimilarityPendingFiles.size > 0) {
				const delay = isUserEditingMarkdown(plugin.app) ? 500 : 50;
				scheduleProcessPendingTermSimilarityQueue(plugin, delay);
			}
		} catch {
			// ignore
		}
	}
}
