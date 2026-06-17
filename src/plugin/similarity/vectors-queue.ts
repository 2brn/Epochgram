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

export function scheduleProcessPendingQueue(plugin: EpochPlugin, delayMs: number = 0): void {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.similarityQueueRunning) return;
	if (anyPlugin.similarityQueueTimer) return;
	anyPlugin.similarityQueueTimer = window.setTimeout(() => {
		anyPlugin.similarityQueueTimer = null;
		void processPendingQueue(plugin);
	}, Math.max(0, Math.floor(delayMs)));
}

export async function processPendingQueue(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.similarityQueueRunning) return;
	const resetKeyAtStart = (() => {
		try {
			const v = Number(anyPlugin.similarityResetKey ?? 0);
			return Number.isFinite(v) ? v : 0;
		} catch {
			return 0;
		}
	})();
	try {
		if (Platform.isDesktopApp && consumeCancelRequested(plugin, "semantic")) {
			anyPlugin.similarityPendingFiles = new Set<string>();
			anyPlugin.similarityQueueTotal = 0;
			anyPlugin.similarityQueueProcessed = 0;
			try {
				anyPlugin.similarityVectorUpdateStartedAt = 0;
			} catch {
				// ignore
			}
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (anyPlugin.similarityFullRebuildRunning) {
			// Full rebuild already computes vectors for all files; avoid redundant work + notices.
			if (anyPlugin.similarityPendingFiles && anyPlugin.similarityPendingFiles.size > 0) {
				scheduleProcessPendingQueue(plugin, 1000);
			}
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (typeof anyPlugin.similarityVectorUpdateStartedAt !== "number" || !(anyPlugin.similarityVectorUpdateStartedAt > 0)) {
			anyPlugin.similarityVectorUpdateStartedAt = now();
			try {
				anyPlugin.similarityQueueProcessed = 0;
				anyPlugin.similarityQueueTotal = 0;
			} catch {
				// ignore
			}
			if (Platform.isDesktopApp) {
				announceEpochDesktopTaskAfter(plugin, "semantic:queued", "Semantics queued", {
					graceMs: 1000,
					minIntervalMs: 1000,
					still: () => {
						try {
							const anyPlugin: any = plugin as any;
							const startedAt = Number(anyPlugin?.similarityVectorUpdateStartedAt ?? 0);
							if (!(Number.isFinite(startedAt) && startedAt > 0)) return false;
							const p: any = anyPlugin?.similarityPendingFiles;
							const hasPending = p instanceof Set && p.size > 0;
							return anyPlugin?.similarityQueueRunning === true || hasPending;
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
	anyPlugin.similarityQueueRunning = true;
	try {
		if (!embeddingsComputeEnabled(plugin)) {
			return;
		}

		try {
			const startedAt = Number(anyPlugin.similarityStartupAt ?? 0);
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
				typeof anyPlugin.similarityVectorUpdateProcessingStartedAt !== "number" ||
				!(anyPlugin.similarityVectorUpdateProcessingStartedAt > 0)
			) {
				anyPlugin.similarityVectorUpdateProcessingStartedAt = now();
			}
		} catch {
			// ignore
		}

		if (!(anyPlugin.similarityPendingFiles instanceof Set)) {
			anyPlugin.similarityPendingFiles = new Set<string>();
		}

		anyPlugin.similarityQueueProcessed = typeof anyPlugin.similarityQueueProcessed === "number" ? Math.max(0, anyPlugin.similarityQueueProcessed) : 0;
		const prevProcessed = anyPlugin.similarityQueueProcessed as number;
		const pendingNow = (anyPlugin.similarityPendingFiles as Set<string>).size;
		anyPlugin.similarityQueueTotal = Math.max(1, prevProcessed + pendingNow);

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
				const currentKeyRaw = Number(anyPlugin.similarityResetKey ?? 0);
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

		while (anyPlugin.similarityPendingFiles instanceof Set && anyPlugin.similarityPendingFiles.size > 0) {
			try {
				if (Platform.isDesktopApp && consumeCancelRequested(plugin, "semantic")) {
					try {
						anyPlugin.similarityPendingFiles = new Set<string>();
						anyPlugin.similarityQueueTotal = 0;
						anyPlugin.similarityQueueProcessed = 0;
						anyPlugin.similarityVectorUpdateStartedAt = 0;
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

			const nextPath = pickNewestPendingPath(plugin, anyPlugin.similarityPendingFiles as Set<string>);
			if (!nextPath) break;
			(anyPlugin.similarityPendingFiles as Set<string>).delete(nextPath);

			anyPlugin.similarityQueueProcessed =
				(typeof anyPlugin.similarityQueueProcessed === "number" ? anyPlugin.similarityQueueProcessed : 0) + 1;
			anyPlugin.similarityQueueTotal = Math.max(1, (anyPlugin.similarityQueueProcessed as number) + (anyPlugin.similarityPendingFiles as Set<string>).size);

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
						anyPlugin.similarityStoreRev =
							(typeof anyPlugin.similarityStoreRev === "number" ? anyPlugin.similarityStoreRev : 0) + 1;
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
				const done = typeof anyPlugin.similarityQueueProcessed === "number" ? anyPlugin.similarityQueueProcessed : 0;
				const tot = typeof anyPlugin.similarityQueueTotal === "number" ? anyPlugin.similarityQueueTotal : 0;
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
		anyPlugin.similarityQueueRunning = false;
		if (!anyPlugin.similarityPendingFiles || anyPlugin.similarityPendingFiles.size === 0) {
			anyPlugin.similarityQueueTotal = 0;
			anyPlugin.similarityQueueProcessed = 0;
			try {
				anyPlugin.similarityVectorUpdateStartedAt = 0;
				anyPlugin.similarityVectorUpdateProcessingStartedAt = 0;
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
			if (anyPlugin.similarityPendingFiles && anyPlugin.similarityPendingFiles.size > 0) {
				const computeOk = embeddingsComputeEnabled(plugin);
				const delay = computeOk ? (isUserEditingMarkdown(plugin.app) ? 500 : 50) : 2000;
				scheduleProcessPendingQueue(plugin, delay);
			}
		} catch {
			// ignore
		}
	}
}
