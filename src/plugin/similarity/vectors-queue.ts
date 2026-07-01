import { Notice, Platform, TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import { isUserEditingMarkdown } from "../notice-utils";
import { announceEpochDesktopTaskAfter, cancelEpochDesktopTaskAnnouncement, clearEpochProgress, consumeCancelRequested, setEpochProgress } from "../progress";
import { getSimilarityModelId } from "./config";
import { debugLog } from "./debug";
import { pickNewestPendingPath } from "./files";
import { shouldAllowSimilarityProgressNotice, shouldShowVectorUpdateNotice } from "./notice";
import { readStore, writeStore } from "./store";
import { now, sleep } from "./time";
import { embeddingsComputeEnabled } from "./runtime";
import { loadEmbeddingsModelViaWorker } from "./worker-embed";
import { buildNoteVector } from "./vectors-build";
import type { SimilarityStore } from "./types";

type SimilarityQueuePluginState = EpochPlugin & {
	similarityQueueRunning?: boolean;
	similarityQueueTimer?: number | null;
	similarityResetKey?: number;
	similarityPendingFiles?: Set<string>;
	similarityQueueTotal?: number;
	similarityQueueProcessed?: number;
	similarityVectorUpdateStartedAt?: number;
	similarityStartupAt?: number;
	similarityVectorUpdateProcessingStartedAt?: number;
	similarityFullRebuildRunning?: boolean;
	similarityStoreRev?: number;
};

function state(plugin: EpochPlugin): SimilarityQueuePluginState {
	return plugin;
}

export function scheduleProcessPendingQueue(plugin: EpochPlugin, delayMs: number = 0): void {
	const pluginState = state(plugin);
	if (pluginState.similarityQueueRunning) return;
	if (pluginState.similarityQueueTimer) return;
	pluginState.similarityQueueTimer = window.setTimeout(() => {
		pluginState.similarityQueueTimer = null;
		void processPendingQueue(plugin);
	}, Math.max(0, Math.floor(delayMs)));
}

export async function processPendingQueue(plugin: EpochPlugin): Promise<void> {
	const pluginState = state(plugin);
	if (pluginState.similarityQueueRunning) return;
	const resetKeyAtStart = (() => {
		try {
			const v = Number(pluginState.similarityResetKey ?? 0);
			return Number.isFinite(v) ? v : 0;
		} catch {
			return 0;
		}
	})();
	try {
		if (Platform.isDesktopApp && consumeCancelRequested(plugin, "semantic")) {
			pluginState.similarityPendingFiles = new Set<string>();
			pluginState.similarityQueueTotal = 0;
			pluginState.similarityQueueProcessed = 0;
			try {
				pluginState.similarityVectorUpdateStartedAt = 0;
			} catch {
				// ignore
			}
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (pluginState.similarityFullRebuildRunning) {
			// Full rebuild already computes vectors for all files; avoid redundant work + notices.
			if (pluginState.similarityPendingFiles && pluginState.similarityPendingFiles.size > 0) {
				scheduleProcessPendingQueue(plugin, 1000);
			}
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (typeof pluginState.similarityVectorUpdateStartedAt !== "number" || !(pluginState.similarityVectorUpdateStartedAt > 0)) {
			pluginState.similarityVectorUpdateStartedAt = now();
			try {
				pluginState.similarityQueueProcessed = 0;
				pluginState.similarityQueueTotal = 0;
			} catch {
				// ignore
			}
			if (Platform.isDesktopApp) {
				announceEpochDesktopTaskAfter(plugin, "semantic:queued", "Semantics queued", {
					graceMs: 1000,
					minIntervalMs: 1000,
					still: () => {
						try {
							const startedAt = Number(state(plugin).similarityVectorUpdateStartedAt ?? 0);
							if (!(Number.isFinite(startedAt) && startedAt > 0)) return false;
							const pending = state(plugin).similarityPendingFiles;
							const hasPending = pending instanceof Set && pending.size > 0;
							return state(plugin).similarityQueueRunning === true || hasPending;
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
	pluginState.similarityQueueRunning = true;
	try {
		if (!embeddingsComputeEnabled(plugin)) {
			return;
		}

		try {
			const startedAt = Number(pluginState.similarityStartupAt ?? 0);
			if (Number.isFinite(startedAt) && startedAt > 0) {
				const STARTUP_GRACE_MS = 8000;
				const elapsed = now() - startedAt;
				if (elapsed >= 0 && elapsed < STARTUP_GRACE_MS) {
					scheduleProcessPendingQueue(plugin, Math.max(250, STARTUP_GRACE_MS - elapsed));
					return;
				}
			}
		} catch {
			// ignore
		}

		// Only start the progress-notice grace window once we are actually allowed to compute
		// (i.e. after startup grace deferrals).
		try {
			if (
				typeof pluginState.similarityVectorUpdateProcessingStartedAt !== "number" ||
				!(pluginState.similarityVectorUpdateProcessingStartedAt > 0)
			) {
				pluginState.similarityVectorUpdateProcessingStartedAt = now();
			}
		} catch {
			// ignore
		}

		if (!(pluginState.similarityPendingFiles instanceof Set)) {
			pluginState.similarityPendingFiles = new Set<string>();
		}

		pluginState.similarityQueueProcessed = typeof pluginState.similarityQueueProcessed === "number" ? Math.max(0, pluginState.similarityQueueProcessed) : 0;
		const prevProcessed = pluginState.similarityQueueProcessed;
		const pendingFiles = pluginState.similarityPendingFiles;
		if (!(pendingFiles instanceof Set)) {
			pluginState.similarityPendingFiles = new Set<string>();
		}
		const pendingNow = pluginState.similarityPendingFiles?.size ?? 0;
		pluginState.similarityQueueTotal = Math.max(1, prevProcessed + pendingNow);

		let processedThisTick = 0;
		const MAX_FILES_PER_TICK = 1;
		const WRITE_EVERY_N_UPDATES = 5;
		const WRITE_MAX_INTERVAL_MS = 15_000;
		let dirtyUpdates = 0;
		let lastWriteAt = now();
		let store: SimilarityStore | null = null;
		let loadedModelId = "";
		let modelLoadedOk = false;

		const maybeFlushStore = async (force: boolean) => {
			try {
				const currentKeyRaw = Number(pluginState.similarityResetKey ?? 0);
				const currentKey = Number.isFinite(currentKeyRaw) ? currentKeyRaw : 0;
				if (currentKey !== resetKeyAtStart) {
					store = null;
					dirtyUpdates = 0;
					lastWriteAt = now();
					return;
				}
			} catch {
				// ignore
			}
			if (!store || dirtyUpdates <= 0) return;
			if (!force) {
				const elapsed = now() - lastWriteAt;
				if (dirtyUpdates < WRITE_EVERY_N_UPDATES && elapsed < WRITE_MAX_INTERVAL_MS) return;
			}
			try {
				await writeStore(plugin, store);
				lastWriteAt = now();
				dirtyUpdates = 0;
				await sleep(0);
			} catch {
				// ignore
			}
		};

		while (pluginState.similarityPendingFiles instanceof Set && pluginState.similarityPendingFiles.size > 0) {
			try {
				if (Platform.isDesktopApp && consumeCancelRequested(plugin, "semantic")) {
					try {
						pluginState.similarityPendingFiles = new Set<string>();
						pluginState.similarityQueueTotal = 0;
						pluginState.similarityQueueProcessed = 0;
						pluginState.similarityVectorUpdateStartedAt = 0;
					} catch {
						// ignore
					}
					break;
				}
			} catch {
				// ignore
			}
			if (!embeddingsComputeEnabled(plugin)) break;
			const modelId = getSimilarityModelId(plugin);
			if (!modelLoadedOk || loadedModelId !== modelId) {
				const loaded = await loadEmbeddingsModelViaWorker(plugin, modelId);
				if (!loaded) {
					debugLog("processPendingQueue:model-load-failed", { model: modelId });
					break;
				}
				loadedModelId = modelId;
				modelLoadedOk = true;
			}

			const pendingSet = pluginState.similarityPendingFiles;
			if (!(pendingSet instanceof Set)) break;
			const nextPath = pickNewestPendingPath(plugin, pendingSet);
			if (!nextPath) break;
			pendingSet.delete(nextPath);

			pluginState.similarityQueueProcessed = (typeof pluginState.similarityQueueProcessed === "number" ? pluginState.similarityQueueProcessed : 0) + 1;
			pluginState.similarityQueueTotal = Math.max(1, pluginState.similarityQueueProcessed + pluginState.similarityPendingFiles.size);

			const file = nextPath ? plugin.app.vault.getAbstractFileByPath(nextPath) : null;
			if (nextPath && !(file instanceof TFile)) continue;

			try {
				if (!store) {
					store = await readStore(plugin);
				}
				if (store.model !== modelId) {
					store.model = modelId;
					store.dim = 0;
					store.files = {};
					dirtyUpdates = Math.max(dirtyUpdates, WRITE_EVERY_N_UPDATES);
				}

				if (file instanceof TFile) {
					const built = await buildNoteVector(plugin, file, modelId);
					if (!built) continue;
					const existing = store.files[file.path];
					if (existing && existing.h === built.hash && Array.isArray(existing.v) && existing.v.length > 0) {
						continue;
					}
					store.files[file.path] = { v: built.vector, h: built.hash, updatedAt: now() };
					if (!store.dim && built.vector.length) store.dim = built.vector.length;
					dirtyUpdates++;
					try {
						pluginState.similarityStoreRev = (typeof pluginState.similarityStoreRev === "number" ? pluginState.similarityStoreRev : 0) + 1;
					} catch {
						// ignore
					}
				}

				await maybeFlushStore(false);
			} catch {
				// ignore per-file
			}

			processedThisTick++;
			if (shouldShowVectorUpdateNotice(plugin) && !isUserEditingMarkdown(plugin.app)) {
				const done = typeof pluginState.similarityQueueProcessed === "number" ? pluginState.similarityQueueProcessed : 0;
				const tot = typeof pluginState.similarityQueueTotal === "number" ? pluginState.similarityQueueTotal : 0;
				if (shouldAllowSimilarityProgressNotice(plugin, "similarityVectorUpdateProcessingStartedAt")) {
					if (Platform.isDesktopApp) {
						setEpochProgress(plugin, "semantic", `Semantics… ${done}/${Math.max(done, tot)}`);
					} else {
						new Notice(`Semantics… ${done}/${Math.max(done, tot)}`, 900);
					}
				}
			}

			if (processedThisTick >= MAX_FILES_PER_TICK) break;
			await sleep(100);
		}

		await maybeFlushStore(true);
	} finally {
		pluginState.similarityQueueRunning = false;
		if (!pluginState.similarityPendingFiles || pluginState.similarityPendingFiles.size === 0) {
			pluginState.similarityQueueTotal = 0;
			pluginState.similarityQueueProcessed = 0;
			try {
				pluginState.similarityVectorUpdateStartedAt = 0;
				pluginState.similarityVectorUpdateProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				if (Platform.isDesktopApp) {
					cancelEpochDesktopTaskAnnouncement(plugin, "semantic:queued");
					clearEpochProgress(plugin, "semantic", 1500);
				}
			} catch {
				// ignore
			}
		}
		try {
			if (pluginState.similarityPendingFiles && pluginState.similarityPendingFiles.size > 0) {
				const computeOk = embeddingsComputeEnabled(plugin);
				const delay = computeOk ? (isUserEditingMarkdown(plugin.app) ? 500 : 50) : 2000;
				scheduleProcessPendingQueue(plugin, delay);
			}
		} catch {
			// ignore
		}
	}
}
