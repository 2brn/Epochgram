import { Notice, normalizePath, Platform, type EventRef } from "obsidian";
import { DEFAULT_SETTINGS, EpochSettingTab } from "../settings";
import { Indexer } from "../indexer/indexer";
import { VIEW_TYPE_EPOCH } from "../ui/epoch-view-mode";
import { EpochView } from "../ui/epoch-view";
import { VIEW_TYPE_WHATS_NEW } from "../ui/whats-new-view-mode";
import { WhatsNewView } from "../ui/whats-new-view";
import { getEpochMarkBaseColorIndexOrder, normalizeMarkColorIndex } from "../ui/mark-colors";
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
import { maybeOpenWhatsNewOnStartup } from "./whats-new";
import {
	mergeSyncedSettingsWithLocalActivation,
	readLocalActivationState
} from "./local-activation-state";

interface LifecycleMethods {
	onload(): Promise<void>;
	onunload(): void;
}

type EpochSettingTabLike = {
	display?: () => void;
};

type LifecycleLeafLike = {
	view?: { file?: unknown };
	getViewState?: () => { state?: { file?: unknown; path?: unknown } };
};

type LifecycleWorkspaceLike = {
	on?: (event: string, callback: () => void) => EventRef;
	getLeavesOfType?: (type: string) => LifecycleLeafLike[];
};

type EpochTimelineViewCommandsLike = {
	toggleReviewedOnly?: () => void;
	toggleContentDates?: () => void;
	toggleAttachments?: () => void;
	toggleTrackedChanges?: () => void;
	toggleEpochsView?: () => void;
};

type LifecycleRuntime = EpochPlugin & {
	refreshAiBridgeStatusBar?: () => void;
	refreshAiBridgeProgress?: () => void;
	similarityStartupAt?: number;
	vectorsFilePath?: string;
	termSimilarityFilePath?: string;
	epochSummariesFilePath?: string;
	updateVectorsFileStat?: () => Promise<void>;
	updateTermSimilarityFileStat?: () => Promise<void>;
	similarityLastVectorsEnabled?: boolean;
	similarityLastZeroShotMinScore?: number;
	registerObsidianProtocolHandler?: (protocol: string, callback: (params: Record<string, string>) => void) => void;
	__epochSettingTab?: EpochSettingTabLike;
	openAiBridgeWindow?: (options: { silent: boolean; source: string }) => void;
	regenerateMissingAiSummariesAndEpochsForAllRecords?: () => void;
	syncAiBridgeConnectionFromWebViewerLeaves?: () => void;
	enqueueAiSummariesForFile?: (path: string, options: { force: boolean; showNotice: boolean; enableIfDisabled: boolean }) => Promise<void>;
	maybeIndexOpenedFile?: (file: unknown) => void;
	persistIndex?: (options: { skipEnsure: true }) => Promise<void>;
	refreshEpochViews?: () => void;
	__epochInheritedMarkIndexByPath?: Map<string, unknown>;
	__epochEnsuredViewOnStartup?: boolean;
	__epochAutoOpenedOnStartup?: boolean;
	__epochAiBridgeStartupPromise?: Promise<void> | null;
	__epochHadSavedSettingsAtStartup?: boolean;
	maybeOpenAiBridgeOnStartup?: () => Promise<void>;
	refreshCalendarSyncSchedule?: () => void;
	maybeRunCalendarSyncOnStartup?: () => Promise<void>;
};

type AppSettingRuntime = {
	open?: () => void;
	openTabById?: (id: string) => void;
};

type LifecycleSettingsRuntime = {
	installId?: string;
	showAttachments?: boolean;
	showTrackedChanges?: boolean;
	showParsed?: boolean;
};

export const lifecycleMethods: LifecycleMethods = {
	async onload(this: EpochPlugin): Promise<void> {
		const runtime = this as LifecycleRuntime;
		// Desktop: keep progress minimal in the status bar.
		try {
			initEpochStatusBarProgress(this);
		} catch {
			// ignore
		}

		try {
			initAiBridgeStatusBar(this);
			runtime.refreshAiBridgeStatusBar = () => refreshAiBridgeStatusBar(this);
			runtime.refreshAiBridgeProgress = () => refreshAiBridgeProgress(this);
			refreshAiBridgeProgress(this);
		} catch {
			// ignore
		}

		// Mark plugin startup; used to delay expensive background work (e.g. embedding)
		// until Obsidian/ORT has fully initialized.
		try {
			runtime.similarityStartupAt = Date.now();
		} catch {
			// ignore
		}

		this.registerCustomIcons();
		this.pluginDirPath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		this.indexFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-index.json`);
		this.dataFilePath = normalizePath(`${this.pluginDirPath}/data.json`);
		runtime.vectorsFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-semantics.json`);
		// Topic classifications (separate from semantic vectors).
		runtime.termSimilarityFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-topics.json`);
		runtime.epochSummariesFilePath = normalizePath(`${this.app.vault.configDir}/epochgram-summaries.json`);
		try {
			await runtime.updateVectorsFileStat?.();
		} catch {
			// ignore
		}
		try {
			await runtime.updateTermSimilarityFileStat?.();
		} catch {
			// ignore
		}

		const saved = (await this.loadData()) as PersistedPluginData | null;
		this.lastDataSignature = this.computeDataSignature(saved);
		const hadSavedSettings = !!saved?.settings;
		runtime.__epochHadSavedSettingsAtStartup = hadSavedSettings;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			mergeSyncedSettingsWithLocalActivation(saved?.settings ?? {}, readLocalActivationState(this))
		);
		const settingsRuntime = this.settings as unknown as LifecycleSettingsRuntime;
		const prevInstallId = String(settingsRuntime.installId ?? "");
		this.ensureDeviceIdentity();
		const didCreateInstallId = String(settingsRuntime.installId ?? "") !== prevInstallId;
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
		const mergedTimelineFilters = Object.assign({}, timelineDefaults, rawTimelineFilters) as LifecycleSettingsRuntime;
		const showDraftsOnly = false;
		const showParsed = mergedTimelineFilters.showParsed !== false;
		const normalizedTimelineFilters: LifecycleSettingsRuntime = {
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
			runtime.similarityLastVectorsEnabled = embeddingsSimilarityEnabled(this);
			const zeroShotRaw = Number(this.settings.similarityZeroShotMinScore ?? 0);
			const zeroShot = Number.isFinite(zeroShotRaw) ? Math.max(0, Math.min(1, zeroShotRaw)) : 0;
			runtime.similarityLastZeroShotMinScore = zeroShot;
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
			if (typeof runtime.registerObsidianProtocolHandler === "function") {
				runtime.registerObsidianProtocolHandler("epochgram", (params: Record<string, string>) => {
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
								const settingsAny = (this.app as unknown as { setting?: AppSettingRuntime }).setting;
								settingsAny?.open?.();
								settingsAny?.openTabById?.(this.manifest.id);
							} catch {
								// ignore
							}
							try {
								runtime.__epochSettingTab?.display?.();
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
								runtime.__epochSettingTab?.display?.();
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

		const withEpochTimelineView = async (run: (view: EpochTimelineViewCommandsLike) => void): Promise<void> => {
			await this.openEpochView({ skipSnap: true });
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
			const leaf = Array.isArray(leaves) && leaves.length > 0 ? leaves[0] : null;
			const view = (leaf?.view ?? null) as unknown as EpochTimelineViewCommandsLike | null;
			if (!view) return;
			run(view);
		};

		this.addCommand({
			id: "toggle-reviewed-only",
			name: "Toggle reviewed only",
			callback: () => {
				void wrapNoticeError("Epochgram: Toggle reviewed only failed", async () => {
					await withEpochTimelineView((view) => {
						view.toggleReviewedOnly?.();
					});
				})();
			}
		});

		this.addCommand({
			id: "toggle-content-dates",
			name: "Toggle content dates",
			callback: () => {
				void wrapNoticeError("Epochgram: Toggle content dates failed", async () => {
					await withEpochTimelineView((view) => {
						view.toggleContentDates?.();
					});
				})();
			}
		});

		this.addCommand({
			id: "toggle-attachments",
			name: "Toggle attachments",
			callback: () => {
				void wrapNoticeError("Epochgram: Toggle attachments failed", async () => {
					await withEpochTimelineView((view) => {
						view.toggleAttachments?.();
					});
				})();
			}
		});

		this.addCommand({
			id: "toggle-tracked-changes",
			name: "Toggle tracked changes",
			checkCallback: (checking: boolean) => {
				try {
					if (!isTrackChangesEffective(this)) return false;
					if (checking) return true;
					void wrapNoticeError("Epochgram: Toggle tracked changes failed", async () => {
						await withEpochTimelineView((view) => {
							view.toggleTrackedChanges?.();
						});
					})();
					return true;
				} catch {
					return false;
				}
			}
		});

		this.addCommand({
			id: "toggle-epochs",
			name: "Toggle Epochs",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasVerifiedEntitlement(this)) return false;
					if (this.settings.generateEpochs !== true) return false;
					if (checking) return true;
					void wrapNoticeError("Epochgram: Toggle Epochs failed", async () => {
						await withEpochTimelineView((view) => {
							view.toggleEpochsView?.();
						});
					})();
					return true;
				} catch {
					return false;
				}
			}
		});

		this.addCommand({
			id: "open-ai-bridge",
			name: "Open AI bridge",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasAiBridgeAccess(this)) return false;
					if (checking) return true;
					if (!Platform.isDesktop) {
						new Notice("AI bridge is available only on desktop.", 2500);
						return true;
					}
					wrapNoticeError("Epochgram: Open AI bridge failed", () =>
						void runtime.openAiBridgeWindow?.({ silent: false, source: "command" })
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
					if (!Platform.isDesktop) {
						new Notice("AI summaries are available only on desktop.", 2500);
						return true;
					}
					wrapNoticeError("Epochgram: Summarize missing failed", () =>
						void runtime.regenerateMissingAiSummariesAndEpochsForAllRecords?.()
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
					if (!Platform.isDesktop) {
						new Notice("AI summaries are available only on desktop.", 2500);
						return true;
					}
					void wrapNoticeError("Epochgram: Summarize current file failed", async () => {
						await runtime.enqueueAiSummariesForFile?.(file.path, {
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

		this.addCommand({
			id: "sync-calendar",
			name: "Sync calendar",
			checkCallback: (checking: boolean) => {
				try {
					if (!hasVerifiedEntitlement(this)) return false;
					if (checking) return true;
					void wrapNoticeError("Epochgram: Calendar sync failed", async () => {
						await this.runCalendarSync({ reason: "manual", showNotice: true });
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
						void runtime.maybeIndexOpenedFile?.(file);
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
								const map = runtime.__epochInheritedMarkIndexByPath;
								if (!(map instanceof Map)) return null;
								return normalizeMarkColorIndex(map.get(file.path));
							} catch {
								return null;
							}
						})();
						const hasAnyMark = explicit != null || inherited != null;
						const desired = hasAnyMark
							? null
							: (getEpochMarkBaseColorIndexOrder()[0] ?? 1);

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
						if (typeof runtime.persistIndex === "function") await runtime.persistIndex({ skipEnsure: true });
					} catch {
						// ignore
					}
					try {
						runtime.refreshEpochViews?.();
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
							if (typeof runtime.persistIndex === "function") await runtime.persistIndex({ skipEnsure: true });
						} catch {
							// ignore
						}
						try {
							runtime.refreshEpochViews?.();
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
							if (typeof runtime.persistIndex === "function") await runtime.persistIndex({ skipEnsure: true });
						} catch {
							// ignore
						}
						try {
							runtime.refreshEpochViews?.();
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

		this.registerView(
			VIEW_TYPE_WHATS_NEW,
			(leaf) => new WhatsNewView(leaf, this)
		);

		try {
			if (!runtime.__epochEnsuredViewOnStartup) {
				runtime.__epochEnsuredViewOnStartup = true;
				this.app.workspace.onLayoutReady(() => {
					window.setTimeout(() => {
							const shouldStartAiBridgeOnStartup = this.settings.openAiBridgeOnStartup === true;
							if (shouldStartAiBridgeOnStartup && !runtime.__epochAiBridgeStartupPromise) {
								runtime.__epochAiBridgeStartupPromise = (async () => {
									try {
										const maybe = runtime.maybeOpenAiBridgeOnStartup;
										if (typeof maybe === "function") await maybe();
									} catch {
										// ignore
									}
								})().finally(() => {
									runtime.__epochAiBridgeStartupPromise = null;
								});
							}

						const shouldAutoOpen = this.settings.openEpochViewOnStartup === true;
						if (shouldAutoOpen) {
							// Startup/activation: use the same open path as ribbon click.
							try {
								if (!runtime.__epochAutoOpenedOnStartup) {
									runtime.__epochAutoOpenedOnStartup = true;
									window.setTimeout(() => {
										try {
											const perf = window.performance;
											const startAt = perf?.now() ?? Date.now();
											const hasOpenMarkdownFile = (): boolean => {
												try {
													const active = this.app.workspace.getActiveFile();
													if (active) return true;
												} catch {
													// ignore
												}
												try {
													const workspace = this.app.workspace as unknown as LifecycleWorkspaceLike;
													const leaves = workspace.getLeavesOfType?.("markdown") ?? [];
													for (const l of leaves) {
														if (l.view?.file) return true;
														const vs = l.getViewState?.();
														const raw = vs?.state?.file ?? vs?.state?.path ?? null;
														if (typeof raw === "string" && raw.length > 0) return true;
													}
												} catch {
													// ignore
												}
												return false;
											};

											const runOpen = () => {
												void (async () => {
													try {
														if (this.settings.openAiBridgeOnStartup === true) {
															const startupPromise = runtime.__epochAiBridgeStartupPromise ?? null;
															if (startupPromise) {
																await Promise.race([
																	startupPromise,
																	new Promise<void>((resolve) => window.setTimeout(resolve, 3000))
																]);
															}
														}
													} catch {
														// ignore
													}
													wrapNoticeError("Epochgram: Auto-open timeline failed", () => this.openEpochView({ activate: true }))();
													if (this.settings.openAiBridgeOnStartup === true) {
														const reclaimFocus = () => {
															try {
																const activeLeaf = (this.app.workspace as unknown as { activeLeaf?: { view?: { getViewType?: () => string } } }).activeLeaf;
																const activeType = activeLeaf?.view?.getViewType?.();
																if (activeType !== VIEW_TYPE_EPOCH) {
																	void this.openEpochView({ activate: true, skipSnap: true });
																}
															} catch {
																// ignore
															}
														};
														window.setTimeout(reclaimFocus, 180);
														window.setTimeout(reclaimFocus, 700);
													}
												})();
											};

											const attemptOpen = () => {
												if (hasOpenMarkdownFile() || (perf?.now() ?? Date.now()) - startAt >= 500) {
													runOpen();
													return;
												}
												window.setTimeout(attemptOpen, 120);
											};

											attemptOpen();
										} catch {
											// ignore
										}
									}, 250);
								}
							} catch {
								// ignore
							}
						}

						void (async () => {
							try {
								await maybeOpenWhatsNewOnStartup(this, runtime.__epochHadSavedSettingsAtStartup === true);
							} catch {
								// ignore
							}
						})();
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

		this.registerInterval(window.setInterval(() => {
			try {
				runtime.syncAiBridgeConnectionFromWebViewerLeaves?.();
			} catch {
				// ignore
			}
		}, 1000));

		const handleConfigChanged = () => {
			if (this.refreshExcludedMatchers()) {
				void this.ensureExcludedSync();
				void this.refreshIndexSmartWithProgress({ suppressNotices: true });
			}
		};
		const workspaceAny = this.app.workspace as unknown as LifecycleWorkspaceLike;
		if (typeof workspaceAny.on === "function") {
			this.registerEvent(workspaceAny.on("config-changed", handleConfigChanged));
			this.registerEvent(workspaceAny.on("obsidian:config-change", handleConfigChanged));
		}

		this.registerInterval(window.setInterval(() => {
			wrapNoticeError("Epochgram: Background poll failed", () => this.pollExternalIndexChanges())();
		}, 15000));

		try {
			runtime.refreshCalendarSyncSchedule?.();
		} catch {
			// ignore
		}
		void (async () => {
			try {
				await runtime.maybeRunCalendarSyncOnStartup?.();
			} catch {
				// ignore
			}
		})();
	},

	onunload(this: EpochPlugin): void {
		try {
			onViewUnload(this);
		} catch {
			// ignore
		}
	}
};
