import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { writeTermStore } from "./similarity-term-store";
import { getSimilarityModelId } from "./similarity/config";
import { clearResultHandlerState } from "./ai-summaries/result-handler";
import {
	clearAllAiSummaries,
	clearAllEmbeddingTerms,
	clearAllMarks,
	clearAllPins,
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

function clearPlannedEpochWork(plugin: EpochPlugin): void {
	try {
		const anyPlugin: any = plugin as any;
		const g: any = globalThis as any;
		try {
			anyPlugin.__epochAiEnqueueCancelKey = (Number(anyPlugin.__epochAiEnqueueCancelKey) || 0) + 1;
		} catch {}
		if (anyPlugin?.epochRegenAfterAiTimer != null) {
			try {
				g?.clearInterval?.(anyPlugin.epochRegenAfterAiTimer);
			} catch {}
			anyPlugin.epochRegenAfterAiTimer = null;
		}
		anyPlugin.epochRegenAfterAiMode = null;
		anyPlugin.epochRegenAfterAiAll = false;
		anyPlugin.epochRegenAfterAiDateKeys = null;
		anyPlugin.epochRegenAfterAiBuckets = null;
		anyPlugin.epochRegenAfterAiShowQueuedNotice = false;
	} catch {
		// ignore
	}
}

function clearPlannedAiWork(plugin: EpochPlugin): void {
	try {
		const anyPlugin: any = plugin as any;
		const g: any = globalThis as any;

		clearPlannedEpochWork(plugin);

		// Cancel in-plugin summarization queue state.
		try {
			anyPlugin.aiSummaryPendingFiles = new Set<string>();
			anyPlugin.aiSummaryQueueRunning = false;
		} catch {
			// ignore
		}

		// Cancel any per-file throttled enqueues waiting on a cooldown timer.
		const throttle: any = anyPlugin?.aiSummaryEnqueueThrottleByFile;
		if (throttle && typeof throttle?.values === "function" && typeof throttle?.clear === "function") {
			try {
				for (const st of throttle.values()) {
					try {
						if (st?.timerId != null) g?.clearTimeout?.(st.timerId);
					} catch {}
					try {
						if (st) {
							st.timerId = null;
							st.pendingJobs = null;
						}
					} catch {}
				}
				throttle.clear();
			} catch {}
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
		const bridge: any = (plugin as any).aiBridge ?? null;
		if (bridge && typeof bridge.clearQueue === "function") {
			bridge.clearQueue();
		}
	} catch {
		// ignore
	}

	try {
		const bridge: any = (plugin as any).aiBridge ?? null;
		const bridgeUrl = typeof bridge?.getUrl === "function" ? String(bridge.getUrl() || "") : "";
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
	await new Promise<void>((resolve) => {
		try {
			if (!Platform.isDesktopApp) {
				resolve();
				return;
			}
			const httpModule = (globalThis as any).__epochNodeHttpModule ?? "node:http";
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const http = require(httpModule) as typeof import("http");
			const req = http.request(
				{
					method: "POST",
					hostname: u.hostname,
					port: Number(u.port || 80),
					path: u.pathname + (u.search || ""),
					headers: {
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body)
					}
				},
				(res) => {
					try {
						res.resume();
					} catch {}
					res.on("end", () => resolve());
					res.on("close", () => resolve());
				}
			);
			req.on("error", () => resolve());
			req.write(body);
			req.end();
		} catch {
			resolve();
		}
	});
}

export async function runReset(plugin: EpochPlugin, sel: ResetSelection, options: { keepLicense: boolean } = { keepLicense: true }): Promise<void> {
	// Prevent overlapping runs.
	try {
		if ((plugin as any).__epochResetInFlight) return;
		(plugin as any).__epochResetInFlight = true;
	} catch {
		// ignore
	}

	try {
		// Cancel any in-flight AI enqueue loops (generate/regenerate commands) early so
		// the reset flow doesn't get misleading "AI summaries: queued ..." notices.
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.__epochAiEnqueueCancelKey = (Number(anyPlugin.__epochAiEnqueueCancelKey) || 0) + 1;
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
				if ((sel as any)?.[key] === true) selectedLabels.push(label);
			} catch {
				// ignore
			}
		};
		addSelected("settings", "Settings");
		addSelected("search", "Search");
		addSelected("dataFiles", "Data files");
		addSelected("marks", "Marks");
		addSelected("reviewState", "Reviews");
		addSelected("pinned", "Pinned");
		addSelected("semantics", "Semantics");
		addSelected("topics", "Topics");
		addSelected("trackedChanges", "Tracked changes");
		addSelected("aiSummaries", "AI summaries");
		addSelected("epochs", "Epochs");

		if (sel.marks) {
			const cleared = clearAllMarks(plugin);
			if (cleared > 0) didSomething = true;
			try {
				(plugin as any).clearInheritedMarksCache?.();
			} catch {
				// ignore
			}
		}

		if (sel.reviewState) {
			const cleared = resetAllReviewStates(plugin);
			if (cleared > 0) didSomething = true;
		}

		if (sel.pinned) {
			const cleared = clearAllPins(plugin);
			if (cleared > 0) didSomething = true;
		}

		if (sel.semantics) {
			try {
				clearSemanticRuntimeState(plugin);
			} catch {
				// ignore
			}
			try {
				await (plugin as any).ensurePluginDir?.();
			} catch {
				// ignore
			}
			try {
				try {
					// Semantics reset clears the vectors store; force re-run of similarity startup maintenance.
					const anyPlugin: any = plugin as any;
					delete anyPlugin.__epochDidSimilarityStartupMaintenance;
					try {
						if (anyPlugin.__epochHugeSimilarityBackfillTimer != null) {
							clearTimeout(anyPlugin.__epochHugeSimilarityBackfillTimer);
							anyPlugin.__epochHugeSimilarityBackfillTimer = null;
						}
					} catch {
						// ignore
					}
					anyPlugin.__epochHugeSimilarityBackfillFiles = null;
					anyPlugin.__epochHugeSimilarityBackfillIndex = 0;
					anyPlugin.__epochHugeSimilarityBackfillRunning = false;
				} catch {
					// ignore
				}

				const vectorsPath = String((plugin as any).vectorsFilePath ?? "");
				if (vectorsPath) {
					await plugin.app.vault.adapter.write(vectorsPath, JSON.stringify({ models: {} }));
				}
				const anyPlugin: any = plugin as any;
				anyPlugin.similarityIndex = { model: getSimilarityModelId(plugin), dim: 0, files: {} };
				anyPlugin.similarityVectorsLoaded = true;
				try {
					if (anyPlugin.similarityQueueTimer) {
						clearTimeout(anyPlugin.similarityQueueTimer);
						anyPlugin.similarityQueueTimer = null;
					}
					anyPlugin.similarityPendingFiles = new Set<string>();
					anyPlugin.similarityQueueTotal = 0;
					anyPlugin.similarityQueueProcessed = 0;
					anyPlugin.similarityVectorUpdateStartedAt = 0;
					anyPlugin.similarityVectorUpdateProcessingStartedAt = 0;
				} catch {
					// ignore
				}
				try {
					anyPlugin.similarityStoreRev =
						(typeof anyPlugin.similarityStoreRev === "number" ? anyPlugin.similarityStoreRev : 0) + 1;
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
				const cleared = plugin.indexer.clearTrackedChanges();
				let baselineReset = false;
				try {
					baselineReset = !!(plugin.indexer as any)?.resetTrackedBaseline?.();
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
			const cleared = clearAllEmbeddingTerms(plugin);
			if (cleared > 0) didSomething = true;
			try {
				try {
					// Topics reset clears the topics store; force re-run of similarity startup maintenance.
					const anyPlugin: any = plugin as any;
					delete anyPlugin.__epochDidSimilarityStartupMaintenance;
					try {
						if (anyPlugin.__epochHugeSimilarityBackfillTimer != null) {
							clearTimeout(anyPlugin.__epochHugeSimilarityBackfillTimer);
							anyPlugin.__epochHugeSimilarityBackfillTimer = null;
						}
					} catch {
						// ignore
					}
					anyPlugin.__epochHugeSimilarityBackfillFiles = null;
					anyPlugin.__epochHugeSimilarityBackfillIndex = 0;
					anyPlugin.__epochHugeSimilarityBackfillRunning = false;
				} catch {
					// ignore
				}

				const emptyStore = { model: "zeroshot", files: {} } as any;
				await writeTermStore(plugin, emptyStore);
				try {
					const anyPlugin: any = plugin as any;
					anyPlugin.termSimilarityIndex = emptyStore;
					anyPlugin.termSimilarityLoaded = true;
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
				(plugin as any).aiSummaryPendingFiles = new Set<string>();
				(plugin as any).aiSummaryQueueRunning = false;
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
				(plugin as any)?.timelineSearchIndex?.clear?.();
			} catch {
				// ignore
			}
			try {
				const leaves = plugin?.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_EPOCH);
				if (Array.isArray(leaves)) {
					for (const leaf of leaves) {
						const view: any = (leaf as any)?.view as any;
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
				const anyThis: any = plugin as any;
				anyThis.__timelineSearchIndexVersion = Number(anyThis.__timelineSearchIndexVersion ?? 0) + 1;
			} catch {
				// ignore
			}
			didSomething = true;
		}

		if (sel.settings) {
			// Preserve license (and keep aiBridgeServer state stable to avoid re-opening duplicate bridge pages).
			const claimKeyPreview = options.keepLicense ? String(plugin.settings.claimKeyPreview ?? "") : "";
			const installId = options.keepLicense ? String((plugin.settings as any).installId ?? "") : "";
			const devicePublicKey = options.keepLicense ? String((plugin.settings as any).devicePublicKey ?? "") : "";
			const activationEnvelope = options.keepLicense ? String((plugin.settings as any).activationEnvelope ?? "") : "";
			const activationWitness = options.keepLicense ? String((plugin.settings as any).activationWitness ?? "") : "";
			const activationStatus = options.keepLicense ? String(plugin.settings.activationStatus ?? "") : "inactive";
			const lastValidationAt = options.keepLicense ? String(plugin.settings.lastValidationAt ?? "") : "";
			const lastValidatedAt = options.keepLicense ? String((plugin.settings as any).lastValidatedAt ?? "") : "";
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
				(plugin as any).clearInheritedMarksCache?.();
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
				const anyThis: any = plugin as any;
				anyThis.__epochCancelRequestedAt = {};
			} catch {
				// ignore
			}
			try {
				(plugin as any)?.timelineSearchIndex?.clear?.();
			} catch {
				// ignore
			}
			try {
				await deleteTimelineSearchCache(plugin);
			} catch {
				// ignore
			}
			try {
				const anyThis: any = plugin as any;
				anyThis.__timelineSearchIndexVersion = Number(anyThis.__timelineSearchIndexVersion ?? 0) + 1;
			} catch {
				// ignore
			}
			try {
				// Data files reset clears vectors/topics stores; force re-run of startup maintenance.
				delete (plugin as any).__epochDidSimilarityStartupMaintenance;
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
			delete (plugin as any).__epochResetInFlight;
		} catch {
			try {
				(plugin as any).__epochResetInFlight = false;
			} catch {
				// ignore
			}
		}
	}
}
