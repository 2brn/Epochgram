import { Notice, Platform, requestUrl } from "obsidian";
import type { EpochPlugin } from "../main";
import { writeTermStore } from "./similarity-term-store";
import { getSimilarityModelId } from "./similarity/config";
import { clearResultHandlerState } from "./ai-summaries/result-handler";
import {
	clearAllAiSummaries,
	clearAllEmbeddingTerms,
	clearEpochEntries,
	clearSemanticRuntimeState,
	clearTopicRuntimeState,
	resetAllReviewStates,
	hardResetTrackedState
} from "./maintenance/reset-helpers";
import { deleteTimelineSearchCache } from "./timeline-search-cache";
import { computeRebuildGating } from "./maintenance-gating";
import type { ResetSelection } from "./maintenance-types";
import { VIEW_TYPE_EPOCH } from "../ui/epoch-view-mode";
import { DEFAULT_SETTINGS } from "../settings-model";
import { hasVerifiedEntitlement, isTrackChangesEffective } from "./pro-feature-state";

type ThrottleState = {
	timerId?: unknown;
	pendingJobs?: unknown;
};

type ThrottleMap = {
	values: () => Iterable<unknown>;
	clear: () => void;
};

type TimelineSearchIndexRuntime = {
	clear?: () => void;
};

type BridgeRuntime = {
	clearQueue?: () => void;
	getUrl?: () => unknown;
};

type MaintenanceRuntime = {
	__epochAiEnqueueCancelKey?: number;
	epochRegenAfterAiTimer?: unknown;
	epochRegenAfterAiMode?: unknown;
	epochRegenAfterAiAll?: boolean;
	epochRegenAfterAiDateKeys?: unknown;
	epochRegenAfterAiBuckets?: unknown;
	epochRegenAfterAiShowQueuedNotice?: boolean;
	aiSummaryPendingFiles?: Set<string>;
	aiSummaryQueueRunning?: boolean;
	aiSummaryEnqueueThrottleByFile?: ThrottleMap;
	aiBridge?: BridgeRuntime | null;
	__epochNodeHttpModule?: string;
	__epochResetInFlight?: boolean;
	clearInheritedMarksCache?: () => void;
	ensurePluginDir?: () => Promise<void> | void;
	vectorsFilePath?: string;
	similarityIndex?: { model: string; dim: number; files: Record<string, unknown> };
	similarityVectorsLoaded?: boolean;
	similarityQueueTimer?: number | null;
	similarityPendingFiles?: Set<string>;
	similarityQueueTotal?: number;
	similarityQueueProcessed?: number;
	similarityVectorUpdateStartedAt?: number;
	similarityVectorUpdateProcessingStartedAt?: number;
	similarityStoreRev?: number;
	__epochDidSimilarityStartupMaintenance?: boolean;
	__epochHugeSimilarityBackfillTimer?: unknown;
	__epochHugeSimilarityBackfillFiles?: unknown;
	__epochHugeSimilarityBackfillIndex?: number;
	__epochHugeSimilarityBackfillRunning?: boolean;
	termSimilarityIndex?: { model: string; files: Record<string, unknown> };
	termSimilarityLoaded?: boolean;
	timelineSearchIndex?: TimelineSearchIndexRuntime;
	__timelineSearchIndexVersion?: number;
	__epochCancelRequestedAt?: Record<string, number>;
};

type IndexerMaintenanceRuntime = {
	clearTrackedChanges: () => boolean;
	resetTrackedBaseline?: () => boolean;
};

type EpochSettingsRuntime = EpochPlugin["settings"] & {
	installId?: string;
	devicePublicKey?: string;
	activationEnvelope?: string;
	activationWitness?: string;
	lastValidatedAt?: string;
};

type EpochViewRuntime = {
	setSearchQueryInternal?: (value: string) => void;
	searchQuery?: string;
	canvas?: { setSearchQuery?: (value: string) => void };
	updateSearchControl?: () => void;
	updateFilterButtons?: () => void;
};

function getRuntime(plugin: EpochPlugin): MaintenanceRuntime {
	return plugin as unknown as MaintenanceRuntime;
}

function clearPlannedEpochWork(plugin: EpochPlugin): void {
	try {
		const runtime = getRuntime(plugin);
		try {
			runtime.__epochAiEnqueueCancelKey = (Number(runtime.__epochAiEnqueueCancelKey) || 0) + 1;
		} catch { void 0; }
		if (runtime.epochRegenAfterAiTimer != null) {
			try {
				(window.clearInterval as unknown as (id: unknown) => void)(runtime.epochRegenAfterAiTimer);
			} catch { void 0; }
			runtime.epochRegenAfterAiTimer = null;
		}
		runtime.epochRegenAfterAiMode = null;
		runtime.epochRegenAfterAiAll = false;
		runtime.epochRegenAfterAiDateKeys = null;
		runtime.epochRegenAfterAiBuckets = null;
		runtime.epochRegenAfterAiShowQueuedNotice = false;
	} catch {
		// ignore
	}
}

function clearPlannedAiWork(plugin: EpochPlugin): void {
	try {
		const runtime = getRuntime(plugin);

		clearPlannedEpochWork(plugin);

		// Cancel in-plugin summarization queue state.
		try {
			runtime.aiSummaryPendingFiles = new Set<string>();
			runtime.aiSummaryQueueRunning = false;
		} catch {
			// ignore
		}

		// Cancel any per-file throttled enqueues waiting on a cooldown timer.
		const throttle = runtime.aiSummaryEnqueueThrottleByFile;
		if (throttle && typeof throttle.values === "function" && typeof throttle.clear === "function") {
			try {
				for (const st of throttle.values()) {
					try {
						if (typeof st === "object" && st !== null) {
							const state = st as ThrottleState;
							if (state.timerId != null) {
								(window.clearTimeout as unknown as (id: unknown) => void)(state.timerId);
							}
						}
					} catch { void 0; }
					try {
						if (typeof st === "object" && st !== null) {
							const state = st as ThrottleState;
							state.timerId = null;
							state.pendingJobs = null;
						}
					} catch { void 0; }
				}
				throttle.clear();
			} catch { void 0; }
		}

		// Drop reduce/chunk aggregation state so it can't enqueue follow-up reduce jobs.
		try {
			clearResultHandlerState(plugin);
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}

async function clearBridgeQueueBestEffort(plugin: EpochPlugin): Promise<void> {
	try {
		const bridge = getRuntime(plugin).aiBridge ?? null;
		if (bridge && typeof bridge.clearQueue === "function") {
			bridge.clearQueue();
		}
	} catch {
		// ignore
	}

	try {
		const bridge = getRuntime(plugin).aiBridge ?? null;
		const bridgeUrl = (() => {
			if (typeof bridge?.getUrl !== "function") return "";
			const raw = bridge.getUrl();
			return typeof raw === "string" ? raw : "";
		})();
		const settingsState = plugin.settings.aiBridgeServer;
		const settingsUrl = (() => {
			const token = typeof settingsState?.token === "string" ? settingsState.token : "";
			const portRaw = typeof settingsState?.port === "number" ? settingsState.port : null;
			const port = portRaw != null && Number.isFinite(portRaw) ? Math.floor(portRaw) : 0;
			if (!token || !(port > 0)) return "";
			return `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
		})();
		const url = bridgeUrl || settingsUrl;
		if (url) {
			await postBridgeClearQueue(url);
		}
	} catch {
		// ignore
	}
}

async function postBridgeClearQueue(url: string): Promise<void> {
	if (Platform.isMobile) return;
	if (!url) return;
	const u = new URL(url);
	u.pathname = "/api/clearQueue";
	// Keep existing token query string.
	const body = "{}";
	try {
		await requestUrl({
			url: String(u),
			method: "POST",
			contentType: "application/json",
			body,
			throw: false
		});
	} catch {
		// ignore
	}
}

export async function runReset(plugin: EpochPlugin, sel: ResetSelection, options: { keepLicense: boolean } = { keepLicense: true }): Promise<void> {
	const runtime = getRuntime(plugin);
	const indexerRuntime = plugin.indexer as unknown as IndexerMaintenanceRuntime;
	// Prevent overlapping runs.
	try {
		if (runtime.__epochResetInFlight) return;
		runtime.__epochResetInFlight = true;
	} catch {
		// ignore
	}

	try {
		// Cancel any in-flight AI enqueue loops (generate/regenerate commands) early so
		// the reset flow doesn't get misleading "AI summaries: queued ..." notices.
		try {
			runtime.__epochAiEnqueueCancelKey = (Number(runtime.__epochAiEnqueueCancelKey) || 0) + 1;
		} catch {
			// ignore
		}

		try {
			await plugin.ensureIndexLoaded();
		} catch {
			// ignore
		}

		let didSomething = false;
		void computeRebuildGating(plugin);
		const selectedLabels: string[] = [];
		const addSelected = (key: keyof ResetSelection, label: string): void => {
			try {
				if (sel[key] === true) selectedLabels.push(label);
			} catch {
				// ignore
			}
		};
		addSelected("settings", "Settings");
		addSelected("search", "Search");
		addSelected("dataFiles", "Data files");
		addSelected("reviewState", "Reviews");
		addSelected("semantics", "Semantics");
		addSelected("topics", "Topics");
		addSelected("trackedChanges", "Tracked changes");
		addSelected("aiSummaries", "AI summaries");
		addSelected("epochs", "Epochs");

		if (sel.reviewState) {
			const cleared = resetAllReviewStates(plugin);
			if (cleared > 0) didSomething = true;
		}

		if (sel.semantics) {
			try {
				clearSemanticRuntimeState(plugin);
			} catch {
				// ignore
			}
			try {
				await runtime.ensurePluginDir?.();
			} catch {
				// ignore
			}
			try {
				try {
					// Semantics reset clears the vectors store; force re-run of similarity startup maintenance.
					delete runtime.__epochDidSimilarityStartupMaintenance;
					try {
						if (runtime.__epochHugeSimilarityBackfillTimer != null) {
							(window.clearTimeout as unknown as (id: unknown) => void)(runtime.__epochHugeSimilarityBackfillTimer);
							runtime.__epochHugeSimilarityBackfillTimer = null;
						}
					} catch {
						// ignore
					}
					runtime.__epochHugeSimilarityBackfillFiles = null;
					runtime.__epochHugeSimilarityBackfillIndex = 0;
					runtime.__epochHugeSimilarityBackfillRunning = false;
				} catch {
					// ignore
				}

				const vectorsPath = String(runtime.vectorsFilePath ?? "");
				if (vectorsPath) {
					await plugin.app.vault.adapter.write(vectorsPath, JSON.stringify({ models: {} }));
				}
				runtime.similarityIndex = { model: getSimilarityModelId(plugin), dim: 0, files: {} };
				runtime.similarityVectorsLoaded = true;
				try {
					if (typeof runtime.similarityQueueTimer === "number") {
						window.clearTimeout(runtime.similarityQueueTimer);
						runtime.similarityQueueTimer = null;
					}
					runtime.similarityPendingFiles = new Set<string>();
					runtime.similarityQueueTotal = 0;
					runtime.similarityQueueProcessed = 0;
					runtime.similarityVectorUpdateStartedAt = 0;
					runtime.similarityVectorUpdateProcessingStartedAt = 0;
				} catch {
					// ignore
				}
				try {
					runtime.similarityStoreRev =
						(typeof runtime.similarityStoreRev === "number" ? runtime.similarityStoreRev : 0) + 1;
				} catch {
					// ignore
				}
				didSomething = true;
			} catch {
				// ignore
			}
		}

		if (sel.trackedChanges) {
			try {
				const cleared = indexerRuntime.clearTrackedChanges();
				let baselineReset = false;
				try {
					baselineReset = indexerRuntime.resetTrackedBaseline?.() === true;
				} catch {
					// ignore
				}

				// Also clear snapshots/baseline so tracked entries can't immediately re-appear due to stale snapshots.
				const hardened = hardResetTrackedState(plugin);
				if (cleared || baselineReset || hardened) didSomething = true;
			} catch {
				// ignore
			}
		}

		if (sel.topics) {
			try {
				const cleared = clearAllEmbeddingTerms(plugin);
				if (cleared > 0) didSomething = true;
				try {
					// Topics reset clears the topics store; force re-run of similarity startup maintenance.
					delete runtime.__epochDidSimilarityStartupMaintenance;
					try {
						if (runtime.__epochHugeSimilarityBackfillTimer != null) {
							(window.clearTimeout as unknown as (id: unknown) => void)(runtime.__epochHugeSimilarityBackfillTimer);
							runtime.__epochHugeSimilarityBackfillTimer = null;
						}
					} catch {
						// ignore
					}
					runtime.__epochHugeSimilarityBackfillFiles = null;
					runtime.__epochHugeSimilarityBackfillIndex = 0;
					runtime.__epochHugeSimilarityBackfillRunning = false;
				} catch {
					// ignore
				}

				const emptyStore = { model: "zeroshot", files: {} };
				await writeTermStore(plugin, emptyStore);
				try {
					runtime.termSimilarityIndex = emptyStore;
					runtime.termSimilarityLoaded = true;
				} catch {
					// ignore
				}
				clearTopicRuntimeState(plugin);
				didSomething = true;
			} catch {
				// ignore
			}
		}

		if (sel.aiSummaries) {
			const cleared = clearAllAiSummaries(plugin);
			if (cleared > 0) didSomething = true;
			try {
				runtime.aiSummaryPendingFiles = new Set<string>();
				runtime.aiSummaryQueueRunning = false;
			} catch {
				// ignore
			}
			try {
				clearPlannedAiWork(plugin);
			} catch {
				// ignore
			}
			// If bridge is running, clear its queue (do not stop it; avoids port churn / duplicate tabs).
			await clearBridgeQueueBestEffort(plugin);
		}

		if (sel.epochs) {
			try {
				clearPlannedEpochWork(plugin);
			} catch {
				// ignore
			}
			// Cancel any in-flight/queued epoch generation work.
			await clearBridgeQueueBestEffort(plugin);
			const removed = clearEpochEntries(plugin);
			if (removed > 0) didSomething = true;
		}

		if (sel.search) {
			try {
				runtime.timelineSearchIndex?.clear?.();
			} catch {
				// ignore
			}
			try {
				const leaves = plugin?.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_EPOCH);
				if (Array.isArray(leaves)) {
					for (const leaf of leaves) {
						const view = (leaf as { view?: unknown })?.view as EpochViewRuntime | undefined;
						if (!view) continue;
						if (typeof view.setSearchQueryInternal === "function") {
							view.setSearchQueryInternal("");
						} else {
							try {
								view.searchQuery = "";
							} catch {
								// ignore
							}
							try {
								view.canvas?.setSearchQuery?.("");
							} catch {
								// ignore
							}
							try {
								view.updateSearchControl?.();
							} catch {
								// ignore
							}
							try {
								view.updateFilterButtons?.();
							} catch {
								// ignore
							}
						}
					}
				}
			} catch {
				// ignore
			}
			try {
				await deleteTimelineSearchCache(plugin);
			} catch {
				// ignore
			}
			try {
				runtime.__timelineSearchIndexVersion = Number(runtime.__timelineSearchIndexVersion ?? 0) + 1;
			} catch {
				// ignore
			}
			didSomething = true;
		}

		if (sel.settings) {
			// Preserve license (and keep aiBridgeServer state stable to avoid re-opening duplicate bridge pages).
			const claimKeyPreview = options.keepLicense ? String(plugin.settings.claimKeyPreview ?? "") : "";
			const settingsRuntime = plugin.settings as EpochSettingsRuntime;
			const installId = options.keepLicense ? String(settingsRuntime.installId ?? "") : "";
			const devicePublicKey = options.keepLicense ? String(settingsRuntime.devicePublicKey ?? "") : "";
			const activationEnvelope = options.keepLicense ? String(settingsRuntime.activationEnvelope ?? "") : "";
			const activationWitness = options.keepLicense ? String(settingsRuntime.activationWitness ?? "") : "";
			const activationStatus = options.keepLicense ? String(plugin.settings.activationStatus ?? "") : "inactive";
			const lastValidationAt = options.keepLicense ? String(plugin.settings.lastValidationAt ?? "") : "";
			const lastValidatedAt = options.keepLicense ? String(settingsRuntime.lastValidatedAt ?? "") : "";
			const proActivatedOnce = options.keepLicense ? plugin.settings.proActivatedOnce === true : false;
			const aiBridgeServer = plugin.settings.aiBridgeServer;
			const aiBridgeOptions = plugin.settings.aiBridgeOptions;
			try {
				plugin.settings = Object.assign({}, DEFAULT_SETTINGS, {
					claimKeyPreview,
					installId,
					devicePublicKey,
					activationEnvelope,
					activationWitness,
					activationStatus,
					lastValidationAt,
					lastValidatedAt,
					proActivatedOnce
				});
				if (aiBridgeServer) plugin.settings.aiBridgeServer = aiBridgeServer;
				if (aiBridgeOptions) plugin.settings.aiBridgeOptions = aiBridgeOptions;
				try {
					await plugin.refreshLicenseState(false);
				} catch {
					// ignore
				}
			} catch {
				// ignore
			}
			try {
				const { applyProResetDefaults } = await import("../settings-reset-defaults");
				if (hasVerifiedEntitlement(plugin)) {
					applyProResetDefaults(plugin.settings);
				}
			} catch {
				// ignore
			}
			try {
				const pro = isTrackChangesEffective(plugin);
				plugin.viewPreferences = {
					showDraftsOnly: false,
					showAttachments: false,
					showTrackedChanges: pro,
					showParsed: true,
					showEpochsView: false
				};
			} catch {
				// ignore
			}
			didSomething = true;
		}

		try {
			await plugin.saveSettings();
		} catch {
			// ignore
		}

		if (sel.dataFiles) {
			try {
				clearTopicRuntimeState(plugin);
			} catch {
				// ignore
			}
			try {
				clearSemanticRuntimeState(plugin);
			} catch {
				// ignore
			}
			try {
				runtime.clearInheritedMarksCache?.();
			} catch {
				// ignore
			}
			try {
				clearPlannedAiWork(plugin);
			} catch {
				// ignore
			}
			try {
				clearPlannedEpochWork(plugin);
			} catch {
				// ignore
			}
			// Data files reset is effectively a full data reset; cancel AI work so it can't repopulate.
			await clearBridgeQueueBestEffort(plugin);
			try {
				runtime.__epochCancelRequestedAt = {};
			} catch {
				// ignore
			}
			try {
				runtime.timelineSearchIndex?.clear?.();
			} catch {
				// ignore
			}
			try {
				await deleteTimelineSearchCache(plugin);
			} catch {
				// ignore
			}
			try {
				runtime.__timelineSearchIndexVersion = Number(runtime.__timelineSearchIndexVersion ?? 0) + 1;
			} catch {
				// ignore
			}
			try {
				// Data files reset clears vectors/topics stores; force re-run of startup maintenance.
				delete runtime.__epochDidSimilarityStartupMaintenance;
			} catch {
				// ignore
			}
			await plugin.clearEpochJsonFilesAndRebuild();
			didSomething = true;
		} else if (didSomething) {
			try {
				await plugin.persist();
			} catch {
				// ignore
			}
			try {
				plugin.refreshEpochViews();
			} catch {
				// ignore
			}
		}

		try {
			if (selectedLabels.length > 0) {
				new Notice(`Epochgram: Reset done (${selectedLabels.join(", ")})`, 1500);
			} else if (didSomething) {
				new Notice("Epochgram: Done", 1200);
			}
		} catch {
			// ignore
		}
	} finally {
		try {
			delete runtime.__epochResetInFlight;
		} catch {
			try {
				runtime.__epochResetInFlight = false;
			} catch {
				// ignore
			}
		}
	}
}
