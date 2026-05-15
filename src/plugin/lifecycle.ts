import { Notice, normalizePath, Platform } from "obsidian";
import { DEFAULT_SETTINGS, EpochSettingTab } from "../settings";
import { Indexer } from "../indexer/indexer";
import { VIEW_TYPE_EPOCH } from "../ui/epoch-view-mode";
import { EpochView } from "../ui/epoch-view";
import { getUsedMarkColorIndexSet, normalizeMarkColorIndex, pickDefaultMarkColorIndex } from "../ui/mark-colors";
import type { PersistedPluginData } from "./state";
import type { EpochPlugin } from "../main";
import { embeddingsSimilarityEnabled } from "./similarity/config";
import { initEpochStatusBarProgress } from "./progress";
import { initAiBridgeStatusBar, refreshAiBridgeStatusBar } from "./ai-bridge-status-bar";
import { refreshAiBridgeProgress } from "./ai-bridge-progress";
import { runSimilarityStartupMaintenance } from "./similarity/startup-maintenance";
import { applyMarkColorWithContext } from "./mark-context";
import { reviewAllDraftFiles } from "./maintenance/reset-helpers";
import { onViewUnload } from "./view/leaf-actions";
import { hasAiBridgeAccess, hasVerifiedEntitlement, isTrackChangesEffective } from "./pro-feature-state";
import { wrapNoticeError } from "./notice-utils";
import {
	mergeSyncedSettingsWithLocalActivation,
	readLocalActivationState
} from "./local-activation-state";

interface LifecycleMethods {
	onload(): Promise<void>;
	onunload(): void;
}

export const lifecycleMethods: LifecycleMethods = {
	async onload(this: EpochPlugin): Promise<void> {
		// Desktop: keep progress minimal in the status bar.
		try {
			initEpochStatusBarProgress(this);
		} catch {
			// ignore
		}

		try {
			initAiBridgeStatusBar(this);
			(this as any).refreshAiBridgeStatusBar = () => refreshAiBridgeStatusBar(this);
			(this as any).refreshAiBridgeProgress = () => refreshAiBridgeProgress(this);
			refreshAiBridgeProgress(this);
		} catch {
			// ignore
		}

		// Mark plugin startup; used to delay expensive background work (e.g. embedding)
		// until Obsidian/ORT has fully initialized.
		try {
			(this as any).similarityStartupAt = Date.now();
		} catch {
			// ignore
		}

		this.registerCustomIcons();
		this.pluginDirPath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
			this.indexFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-index.json`);
		this.dataFilePath = normalizePath(`${this.pluginDirPath}/data.json`);
		(this as any).vectorsFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-semantics.json`);
		// Topic classifications (separate from semantic vectors).
		(this as any).termSimilarityFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-topics.json`);
		(this as any).epochSummariesFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-summaries.json`);
		try {
			await (this as any).updateVectorsFileStat?.();
		} catch {
			// ignore
		}
		try {
			await (this as any).updateTermSimilarityFileStat?.();
		} catch {
			// ignore
		}

		const saved = (await this.loadData()) as PersistedPluginData | null;
		this.lastDataSignature = this.computeDataSignature(saved);
		const hadSavedSettings = !!saved?.settings;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			mergeSyncedSettingsWithLocalActivation(saved?.settings ?? {}, readLocalActivationState(this))
		);
		const prevInstallId = String((this.settings as any).installId ?? "");
		this.ensureDeviceIdentity();
		const didCreateInstallId = String((this.settings as any).installId ?? "") !== prevInstallId;
		const licenseChanged = await this.refreshLicenseState();
		if (!hadSavedSettings) {
			this.applyDailyNotesDefaults();
		}
		this.indexer = new Indexer(this);
		this.refreshExcludedMatchers();
		// View preferences (persisted in settings.timelineFilters).
		let didNormalizeFilters = false;
		const timelineDefaults = DEFAULT_SETTINGS.timelineFilters ?? {};
		const rawTimelineFilters = this.settings.timelineFilters ?? {};
		const mergedTimelineFilters: any = Object.assign({}, timelineDefaults, rawTimelineFilters);
		const showDraftsOnly = mergedTimelineFilters.showDraftsOnly === true;
		const showParsed = mergedTimelineFilters.showParsed !== false;
		const normalizedTimelineFilters: any = {
			showDraftsOnly,
			showAttachments: mergedTimelineFilters.showAttachments === true,
			showTrackedChanges: mergedTimelineFilters.showTrackedChanges !== false,
			showParsed
		};

		// Ensure persisted values include defaults and respect hard gating.
		try {
			const before = JSON.stringify(rawTimelineFilters ?? {});
			const after = JSON.stringify(normalizedTimelineFilters);
			if (before !== after) {
				this.settings.timelineFilters = Object.assign({}, normalizedTimelineFilters);
				didNormalizeFilters = true;
			}
		} catch {
			// ignore
		}

		this.viewPreferences = {
			showDraftsOnly,
			showAttachments: !!normalizedTimelineFilters.showAttachments,
			showTrackedChanges: !!normalizedTimelineFilters.showTrackedChanges,
			showParsed: !!normalizedTimelineFilters.showParsed,
			showEpochsView: false
		};
		if (!hasVerifiedEntitlement(this)) {
			this.disableProViewPreferences();
		}
		if (!hadSavedSettings || didCreateInstallId || licenseChanged || didNormalizeFilters) {
			await this.saveSettings();
		}

		void this.validateStoredActivationToken({ source: "startup" });

		// Initialize last-known similarity settings state so first-time toggles from
		// "disabled" thresholds correctly enqueue missing background work.
		try {
			const anyPlugin: any = this as any;
			anyPlugin.similarityLastVectorsEnabled = embeddingsSimilarityEnabled(this);
			const zeroShotRaw = Number(this.settings.similarityZeroShotMinScore ?? 0);
			const zeroShot = Number.isFinite(zeroShotRaw) ? Math.max(0, Math.min(1, zeroShotRaw)) : 0;
			anyPlugin.similarityLastZeroShotMinScore = zeroShot;
		} catch {
			// ignore
		}

		this.indexReady = false;
		this.indexLoadPromise = (async () => {
			try {
				const hasIndex = await this.initializeIndex();
				if (!hasIndex) {
					await this.rebuildIndexWithProgress({ skipEnsure: true, baseline: true });
				}
			} catch (error) {
				void error;
				await this.rebuildIndexWithProgress({
					skipEnsure: true,
					suppressNotices: false,
					baseline: true
				});
			} finally {
				this.indexReady = true;
				this.indexLoadPromise = null;
				this.refreshEpochViews();
				void this.ensureExcludedSync();
			}
		})();

		// Register vault/workspace event handlers immediately (even while the index is still loading)
		// so we don't miss startup-created notes (notably on mobile).
		this.registerFileEvents();

		// Startup maintenance: if semantic vectors/topics are enabled, enqueue missing work.
		void (async () => {
			try {
				await this.ensureIndexLoaded();
			} catch {
				return;
			}
			try {
				await runSimilarityStartupMaintenance(this);
			} catch {
				// ignore
			}
		})();

		this.addSettingTab(new EpochSettingTab(this.app, this));

		try {
			const anyThis: any = this as any;
			if (typeof anyThis.registerObsidianProtocolHandler === "function") {
				anyThis.registerObsidianProtocolHandler("epochgram", (params: Record<string, string>) => {
					void (async () => {
						const raw = String(params?.key ?? params?.claimKey ?? "").trim();
						if (!raw) {
							new Notice("Epochgram Pro activation link is missing a key.", 6000);
							return;
						}
						this.proActivationPendingKey = raw;
						this.proActivationBusy = true;
						let activationSucceeded = false;
						try {
							try {
								const settingsAny: any = (this.app as any)?.setting;
								settingsAny?.open?.();
								settingsAny?.openTabById?.(this.manifest.id);
							} catch {
								// ignore
							}
							try {
								anyThis.__epochSettingTab?.display?.();
							} catch {
								// ignore
							}
							const result = await this.applyClaimKey(raw);
							activationSucceeded = result.valid === true;
							new Notice(result.message, 6000);
						} catch {
							new Notice("Epochgram Pro activation failed.", 6000);
						} finally {
							this.proActivationBusy = false;
							if (activationSucceeded) this.proActivationPendingKey = "";
							try {
								anyThis.__epochSettingTab?.display?.();
							} catch {
								// ignore
							}
						}
					})();
				});
			}
		} catch {
			// ignore
		}

		this.addCommand({
			id: "open-view",
			name: "Open timeline",
			callback: wrapNoticeError("Epochgram: Open timeline failed", () => this.openEpochView())
		});

		this.addCommand({
			id: "search-timeline",
			name: "Search timeline",
			callback: wrapNoticeError("Epochgram: Search timeline failed", () => this.openTimelineSearch())
		});

		this.addCommand({
			id: "open-ai-bridge",
			name: "Open AI bridge",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasAiBridgeAccess(this)) return false;
					if (checking) return true;
					if (!Platform.isDesktopApp) {
						new Notice("AI bridge is available only on desktop.", 2500);
						return true;
					}
					wrapNoticeError("Epochgram: Open AI bridge failed", () =>
						(this as any).openAiBridgeWindow?.({ silent: false, source: "command" })
					)();
					return true;
				} catch {
					return false;
				}
			}
		});

		this.addCommand({
			id: "summarize-all",
			name: "Summarize missing",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasAiBridgeAccess(this)) return false;
					if (checking) return true;
					if (!Platform.isDesktopApp) {
						new Notice("AI summaries are available only on desktop.", 2500);
						return true;
					}
					wrapNoticeError("Epochgram: Summarize missing failed", () =>
						(this as any).regenerateMissingAiSummariesAndEpochsForAllRecords?.()
					)();
					return true;
				} catch {
					return false;
				}
			}
		});

		this.addCommand({
			id: "summarize-current",
			name: "Summarize current file",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasAiBridgeAccess(this)) return false;
					const file = this.app.workspace.getActiveFile();
					if (!file) return false;
					if (!this.shouldIndexFile(file)) return false;
					if (!this.indexer.isFileKnown(file.path)) return false;
					if (checking) return true;
					if (!Platform.isDesktopApp) {
						new Notice("AI summaries are available only on desktop.", 2500);
						return true;
					}
					void wrapNoticeError("Epochgram: Summarize current file failed", async () => {
						await (this as any).enqueueAiSummariesForFile?.(file.path, {
							force: true,
							showNotice: true,
							enableIfDisabled: true
						});
					})();
					return true;
				} catch {
					return false;
				}
			}
		});

		try {
			const fileOpenRef = this.app.workspace.on("file-open", (file) => {
				if (file) {
					try {
						void (this as any).maybeIndexOpenedFile?.(file);
					} catch {
						// ignore
					}
				} else {
					// ignore
				}
			});
			this.registerEvent(fileOpenRef);
			this.workspaceEventRefs.push(fileOpenRef);
		} catch {
			// ignore
		}


		this.addCommand({
			id: "toggle-mark-current-note",
			name: "Toggle mark for current file",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!this.shouldIndexFile(file)) return false;
				if (!this.indexer.isFileKnown(file.path)) return false;
				if (!checking) {
					void wrapNoticeError("Epochgram: Toggle mark failed", async () => {
						try {
							await this.ensureIndexLoaded();
							await this.waitForExcludedSync();
						} catch {
							// ignore
						}

						const current: number | null = this.indexer.getFileMarkColor(file.path);
						const explicit = normalizeMarkColorIndex(current);
						const inherited: number | null = (() => {
							if (explicit != null) return null;
							try {
								const map: unknown = (this as any)?.__epochInheritedMarkIndexByPath;
								if (!(map instanceof Map)) return null;
								return normalizeMarkColorIndex(map.get(file.path));
							} catch {
								return null;
							}
						})();
						const hasAnyMark = explicit != null || inherited != null;
						const filesObj: any = this.indexer.toJSON().files;

						const desired = hasAnyMark
							? null
							: pickDefaultMarkColorIndex(getUsedMarkColorIndexSet(filesObj, file.path), current);

						await applyMarkColorWithContext(this, {
							entryPath: file.path,
							nextColorIndex: desired,
							currentColorIndex: explicit ?? inherited
						});
					})();
				}
				return true;
			}
		});

		this.addCommand({
			id: "toggle-pin-current-note",
			name: "Toggle pin for current file",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!this.shouldIndexFile(file)) return false;
				if (!this.indexer.isFileKnown(file.path)) return false;
				const nextPinned = !this.indexer.isFilePinned(file.path);
				if (!checking) {
					wrapNoticeError("Epochgram: Toggle pin failed", () => this.toggleFilePin(file, nextPinned))();
				}
				return true;
			}
		});

		this.addCommand({
			id: "toggle-visibility-current-file",
			name: "Toggle visibility for current file",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!this.shouldIndexFile(file)) return false;
				if (!this.indexer.isFileKnown(file.path)) return false;
				if (checking) return true;

				void wrapNoticeError("Epochgram: Toggle visibility failed", async () => {
					try {
						await this.ensureIndexLoaded();
						await this.waitForExcludedSync();
					} catch {
						// ignore
					}
					let result: "hidden" | "visible" | null = null;
					try {
						result = this.indexer.toggleFileVisibility(file.path);
					} catch {
						result = null;
					}
					if (!result) {
						new Notice("Epochgram: No records for current file", 2500);
						return;
					}

					try {
						if (typeof (this as any)?.persistIndex === "function") await (this as any).persistIndex({ skipEnsure: true });
					} catch {
						// ignore
					}
					try {
						(this as any)?.refreshEpochViews?.();
					} catch {
						// ignore
					}
				})();
				return true;
			}
		});

		this.addCommand({
			id: "clear-tracked-changes-current-note",
			name: "Clear tracked changes for current file",
			checkCallback: (checking: boolean) => {
				if (!isTrackChangesEffective(this)) return false;
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!this.shouldIndexFile(file)) return false;
				if (!this.indexer.isFileKnown(file.path)) return false;
				if (checking) return true;
				void wrapNoticeError("Epochgram: Clear tracked changes failed", async () => {
					try {
						await this.ensureIndexLoaded();
					} catch {
						// ignore
					}
					let changed = false;
					try {
						changed = this.indexer.clearTrackedChangesForPath(file.path);
					} catch {
						changed = false;
					}

					if (changed) {
						try {
							if (typeof (this as any)?.persistIndex === "function") await (this as any).persistIndex({ skipEnsure: true });
						} catch {
							// ignore
						}
						try {
							(this as any)?.refreshEpochViews?.();
						} catch {
							// ignore
						}
						new Notice(`Epochgram: Cleared tracked changes for ${file.basename}`, 2000);
					} else {
						new Notice("Epochgram: No tracked changes for current file", 2500);
					}
				})();
				return true;
			}
		});

		this.addCommand({
			id: "review-all",
			name: "Review all",
			callback: () => {
				void wrapNoticeError("Epochgram: Review all failed", async () => {
					try {
						await this.ensureIndexLoaded();
					} catch {
						// ignore
					}
					const changed = reviewAllDraftFiles(this);
					if (changed > 0) {
						try {
							if (typeof (this as any)?.persistIndex === "function") await (this as any).persistIndex({ skipEnsure: true });
						} catch {
							// ignore
						}
						try {
							(this as any)?.refreshEpochViews?.();
						} catch {
							// ignore
						}
						new Notice(`Epochgram: Reviewed ${changed} file${changed === 1 ? "" : "s"}`, 2000);
					}
				})();
			}
		});

		this.addRibbonIcon("epochgram-logo", "Epochgram", () => {
			wrapNoticeError("Epochgram: Open timeline failed", () => this.openEpochView())();
		});

		this.registerView(
			VIEW_TYPE_EPOCH,
			(leaf) => new EpochView(leaf, this)
		);

		try {
			const anyPlugin: any = this as any;
			if (!anyPlugin.__epochEnsuredViewOnStartup) {
				anyPlugin.__epochEnsuredViewOnStartup = true;
				this.app.workspace.onLayoutReady(() => {
					window.setTimeout(() => {
						const shouldAutoOpen = this.settings.openEpochViewOnStartup === true;
						if (shouldAutoOpen) {
							try {
								wrapNoticeError("Epochgram: Auto-open view failed", () => this.ensureEpochViewLeaf())();
							} catch {
								// ignore
							}

							// Startup/activation: switch to the Epoch timeline once the workspace is ready.
							try {
								if (!anyPlugin.__epochAutoOpenedOnStartup) {
									anyPlugin.__epochAutoOpenedOnStartup = true;
									window.setTimeout(() => {
										try {
											wrapNoticeError("Epochgram: Auto-open timeline failed", () => this.openEpochView())();
										} catch {
											// ignore
										}
									}, 250);
								}
							} catch {
								// ignore
							}
						}
					}, 1);
				});
			}
		} catch {
			// ignore
		}
		this.registerHoverLinkSource(this.manifest.id, {
			display: this.manifest.name ?? "Epochgram",
			defaultMod: false
		});

		this.registerFileMenu();

		// AI bridge: start server on startup so an already-open Chrome bridge page can reconnect
		// after plugin reload. Only open a new Chrome tab if no bridge page connects.
		try {
			window.setTimeout(() => {
				try {
					const maybe: any = (this as any).maybeOpenAiBridgeOnStartup;
					if (typeof maybe === "function") {
						wrapNoticeError("Epochgram: AI bridge startup failed", () => maybe.call(this))();
					}
				} catch {
					// ignore
				}
			}, 750);
		} catch {
			// ignore
		}

		const handleConfigChanged = () => {
			if (this.refreshExcludedMatchers()) {
				void this.ensureExcludedSync();
				void this.refreshIndexSmartWithProgress({ suppressNotices: true });
			}
		};
		const workspaceAny = this.app.workspace as any;
		if (workspaceAny?.on) {
			this.registerEvent(workspaceAny.on("config-changed", handleConfigChanged));
			this.registerEvent(workspaceAny.on("obsidian:config-change", handleConfigChanged));
		}

		this.registerInterval(window.setInterval(() => {
			wrapNoticeError("Epochgram: Background poll failed", () => this.pollExternalIndexChanges())();
		}, 15000));
	},

	onunload(this: EpochPlugin): void {
		try {
			onViewUnload(this);
		} catch {
			// ignore
		}
	}
};
