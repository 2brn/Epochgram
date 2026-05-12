import { Notice, Platform, TFile } from "obsidian";
import type { SerializedEpochIndex } from "../indexer/types";
import type { EpochPlugin } from "../main";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
import {
	applyAiSummaries,
	applyEpochEntriesByDate,
	loadEpochSummariesFromDisk
} from "./ai-summaries/epoch-summaries-store";
import {
	announceEpochDesktopTaskAfter,
	cancelEpochDesktopTaskAnnouncement,
	clearEpochProgress,
	setEpochProgress
} from "./progress";
import { hydrateTimelineSearchIndexFromLoadedState } from "./timeline-search-hydration";
import { bumpTimelineSearchIndexVersion, loadTimelineSearchCache, saveTimelineSearchCache } from "./timeline-search-cache";
import { isTrackChangesEffective } from "./pro-feature-state";

interface IndexOperationOptions {
	skipEnsure?: boolean;
	suppressNotices?: boolean;
	baseline?: boolean;
}

interface RefreshOptions {
	skipEnsure?: boolean;
	suppressNotices?: boolean;
}

export interface IndexingMethods {
	rebuildIndexWithProgress(options?: IndexOperationOptions): Promise<void>;
	refreshIndexSmartWithProgress(options?: RefreshOptions): Promise<void>;
	runIndexOperation(mode: "rebuild" | "refresh", options?: IndexOperationOptions): Promise<void>;
	ensureIndexLoaded(): Promise<void>;
	maybeIndexOpenedFile(file: TFile): Promise<void>;
	initializeIndex(): Promise<boolean>;
	loadIndexFromDisk(): Promise<SerializedEpochIndex | undefined>;
	indexHasContent(serialized: SerializedEpochIndex | undefined): boolean;
	getIndexableFiles(): TFile[];
	removePathsFromIndex(paths: string[]): boolean;
}

export const indexingMethods: IndexingMethods = {
	async rebuildIndexWithProgress(this: EpochPlugin, options?: IndexOperationOptions): Promise<void> {
		await this.runIndexOperation("rebuild", options);
	},

	async refreshIndexSmartWithProgress(
		this: EpochPlugin,
		options?: RefreshOptions
	): Promise<void> {
		await this.runIndexOperation("refresh", options);
	},

	async runIndexOperation(
		this: EpochPlugin,
		mode: "rebuild" | "refresh",
		options: IndexOperationOptions = {}
	): Promise<void> {
		const { skipEnsure = false, suppressNotices = false, baseline = false } = options;
		// Track operation start so progress notices don't fire immediately.
		try {
			(this as any).indexOperationStartedAt = Date.now();
		} catch {
			// ignore
		}
		if (!skipEnsure) {
			await this.ensureIndexLoaded();
		}
		try {
			(this as any).timelineSearchIndex?.clear?.();
		} catch {
			// ignore
		}
		const hadTrackedBefore = this.indexer.hasTrackedChanges?.() ?? false;
		if (baseline && isTrackChangesEffective(this)) {
			this.indexer.prepareTrackedBaseline();
		}
		this.refreshExcludedMatchers();
		await this.waitForExcludedSync();

		const files = this.getIndexableFiles();
		const progressLabel = mode === "rebuild" ? "Indexing…" : "Refreshing…";
		const successLabel = mode === "rebuild" ? "Epochgram index rebuilt" : "Epochgram index refreshed";
		if (!suppressNotices && Platform.isDesktopApp) {
			announceEpochDesktopTaskAfter(this, `index:${mode}:start`, mode === "rebuild" ? "Epochgram indexing started" : "Epochgram refresh started", {
				graceMs: 1000,
				still: () => {
					try {
						return !(this as any).indexReady || !!(this as any).indexLoadPromise;
					} catch {
						return true;
					}
				}
			});
		}

		this.lastRebuildNoticeAt = 0;
		const progressHandler = suppressNotices
			? undefined
			: (processed: number, total: number) => {
				const now = Date.now();
				const startedAt = (() => {
					try {
						const v = Number((this as any).indexOperationStartedAt ?? 0);
						return Number.isFinite(v) ? v : 0;
					} catch {
						return 0;
					}
				})();
				// Avoid showing progress for very fast operations.
				const graceMs = Platform.isMobileApp ? 10000 : 1000;
				if (startedAt > 0 && now - startedAt < graceMs) return;
				const minMs = Platform.isMobileApp ? 10000 : 1000;
				if (now - this.lastRebuildNoticeAt > minMs) {
					this.lastRebuildNoticeAt = now;
					if (Platform.isDesktopApp) {
						setEpochProgress(this, "index", `${progressLabel} ${processed}/${total}`);
					} else {
						new Notice(`${progressLabel} ${processed}/${total}`);
					}
				}
			};

		const operationPromise =
			mode === "rebuild"
				? this.indexer.rebuildAll(files, progressHandler)
				: this.indexer.reprocessAll(files, progressHandler);

		const isCancelledError = (e: any): boolean => {
			try {
				return String(e?.code || "") === "EPOCH_CANCELLED" || String(e?.message || "") === "EPOCH_CANCELLED";
			} catch {
				return false;
			}
		};

		this.indexLoadPromise = (async () => {
			try {
				await operationPromise;
			} catch (error) {
				if (isCancelledError(error)) return;
				throw error;
			}
		})();
		this.indexReady = false;

		let baselineCleanup = false;
		let cancelled = false;
		try {
			try {
				await operationPromise;
			} catch (e) {
				if (isCancelledError(e)) {
					cancelled = true;
					return;
				}
				throw e;
			}
			if (baseline && mode === "rebuild" && isTrackChangesEffective(this)) {
				const cleared = this.indexer.clearTrackedChanges();
				const reset = this.indexer.resetTrackedBaseline();
				baselineCleanup = cleared || reset;
			}
			await this.persist({ skipEnsure: true });
		} finally {
			this.indexReady = true;
			this.indexLoadPromise = null;
			try {
				delete (this as any)?.__epochCancelRequestedAt?.index;
			} catch {
				// ignore
			}
			try {
				if (Platform.isDesktopApp) {
					cancelEpochDesktopTaskAnnouncement(this, `index:${mode}:start`);
				}
			} catch {
				// ignore
			}
			if (!suppressNotices && Platform.isDesktopApp) {
				clearEpochProgress(this, "index", 1500);
			}
		}
		if (cancelled) return;

		if (baseline && mode === "rebuild" && isTrackChangesEffective(this)) {
			if (baselineCleanup) {
				if (!suppressNotices) {
					new Notice(successLabel);
				}
				try {
					const anyThis: any = this as any;
					anyThis.__epochTimelineSearchFocusToken = Number(anyThis.__epochTimelineSearchFocusToken ?? 0) + 1;
				} catch {
					// ignore
				}
				this.refreshEpochViews();
				return;
			}
		}

		if (isTrackChangesEffective(this) && !baseline && !hadTrackedBefore) {
			const cleared = this.indexer.clearTrackedChanges();
			if (cleared) {
				await this.persist({ skipEnsure: true });
			}
		}

		if (!suppressNotices) {
			new Notice(successLabel);
		}
		try {
			await saveTimelineSearchCache(this);
		} catch {
			// ignore
		}

		try {
			if (mode === "rebuild") {
				const anyThis: any = this as any;
				anyThis.__epochTimelineSearchFocusToken = Number(anyThis.__epochTimelineSearchFocusToken ?? 0) + 1;
			}
		} catch {
			// ignore
		}

		this.refreshEpochViews();
	},

	async ensureIndexLoaded(this: EpochPlugin): Promise<void> {
		if (!this.indexReady) {
			if (this.indexLoadPromise) {
				await this.indexLoadPromise;
			}
		}
		// Inherited mark colors are computed lazily; after a plugin/app reload the cache starts empty.
		// Ensure we schedule a background recompute once the index is available so inherited colors
		// show up without requiring a manual mark change.
		try {
			if (!this.hasProAccess?.()) return;
			const anyPlugin: any = this as any;
			if (anyPlugin.__epochInheritedMarkStartupScheduled === true) return;
			const computedAtRaw = Number(anyPlugin.__epochInheritedMarkComputedAt ?? 0);
			const computedAt = Number.isFinite(computedAtRaw) ? computedAtRaw : 0;
			if (computedAt > 0 && anyPlugin.__epochInheritedMarkIndexByPath instanceof Map) return;
			anyPlugin.__epochInheritedMarkStartupScheduled = true;
			(this as any).scheduleInheritedMarkRecompute?.("startup");
		} catch {
			// ignore
		}
	},

	async maybeIndexOpenedFile(this: EpochPlugin, file: TFile): Promise<void> {
		try {
			if (!file?.path) return;
			if (!this.shouldIndexFile(file)) return;
			if (this.indexer.isFileKnown(file.path)) return;

			const anyPlugin: any = this as any;
			if (!(anyPlugin.__epochIndexOnOpenInFlight instanceof Set)) {
				anyPlugin.__epochIndexOnOpenInFlight = new Set<string>();
			}
			const inFlight: Set<string> = anyPlugin.__epochIndexOnOpenInFlight;
			if (inFlight.has(file.path)) return;
			inFlight.add(file.path);

			try {
				// Give Obsidian a moment to finish writing the file on startup/mobile.
				const delayMs = Platform.isMobileApp ? 350 : 75;
				await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				if (!this.indexReady) return;
				if (!this.shouldIndexFile(file)) return;
				if (this.indexer.isFileKnown(file.path)) return;

				await this.indexer.processFile(file, { reason: "open" });
				await this.persist({ skipEnsure: true });
				try {
					(this as any).queueVectorUpdate?.(file.path);
				} catch {
					// ignore
				}
				try {
					(this as any).queueTermSimilarityUpdate?.(file.path);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			} finally {
				inFlight.delete(file.path);
			}
		} catch {
			// ignore
		}
	},

	async initializeIndex(this: EpochPlugin): Promise<boolean> {
		try {
			const diskIndex = await this.loadIndexFromDisk();
			if (diskIndex) {
				const sanitized = normalizeSerializedEpochIndexForDisk(diskIndex);
				await this.indexer.load(sanitized);
				try {
					const loaded = await loadEpochSummariesFromDisk(this);
					applyEpochEntriesByDate(this, loaded.epochsByDate);
					applyAiSummaries(this, loaded.aiSummaries);
				} catch {
					// ignore
				}
				// MiniSearch: hydrate in-memory timeline search index from already-loaded state.
				// This avoids requiring a full reindex on startup when a disk index exists.
				try {
					const loaded = await loadTimelineSearchCache(this);
					if (!loaded) {
						hydrateTimelineSearchIndexFromLoadedState(this);
						// If the on-disk MiniSearch cache is missing/corrupt, hydration only indexes
						// summaries/meta (not full file text). Schedule a background rebuild so
						// "deep" search is restored automatically.
						try {
							const anyThis: any = this as any;
							if (anyThis.__timelineSearchAutoRebuildScheduled !== true && Platform.isDesktopApp) {
								anyThis.__timelineSearchAutoRebuildScheduled = true;
								(globalThis as any).setTimeout?.(() => {
									try {
										void (this as any).rebuildTimelineSearchIndex?.();
									} catch {
										// ignore
									}
								}, 2500);
							}
						} catch {
							// ignore
						}
					}
					// Hydration mutates the MiniSearch index; bump the version so any cached match
					// sets in the UI (keyed by __timelineSearchIndexVersion) are invalidated.
					bumpTimelineSearchIndexVersion(this);
				} catch {
					// ignore
				}
				await this.updateIndexFileStat();
				await this.savePluginData(sanitized);
				return this.indexHasContent(sanitized);
			}

			await this.indexer.load(undefined);
			try {
				const loaded = await loadEpochSummariesFromDisk(this);
				applyEpochEntriesByDate(this, loaded.epochsByDate);
				applyAiSummaries(this, loaded.aiSummaries);
			} catch {
				// ignore
			}
			await this.updateIndexFileStat();
			await this.savePluginData();
			return false;
		} catch (error) {
			void error;
			await this.indexer.load(undefined);
			try {
				const loaded = await loadEpochSummariesFromDisk(this);
				applyEpochEntriesByDate(this, loaded.epochsByDate);
				applyAiSummaries(this, loaded.aiSummaries);
			} catch {
				// ignore
			}
			await this.updateIndexFileStat();
			await this.savePluginData();
			return false;
		}
	},

	async loadIndexFromDisk(this: EpochPlugin): Promise<SerializedEpochIndex | undefined> {
		try {
			const exists = await this.app.vault.adapter.exists(this.indexFilePath);
			if (!exists) return undefined;
			const raw = await this.app.vault.adapter.read(this.indexFilePath);
			if (!raw) return undefined;
			const parsed = JSON.parse(raw) as SerializedEpochIndex;
			if (!parsed?.dates || !parsed?.files) return undefined;
			return parsed;
		} catch (error) {
			void error;
			return undefined;
		}
	},

	indexHasContent(_serialized: SerializedEpochIndex | undefined): boolean {
		const serialized = _serialized;
		if (!serialized?.dates) return false;
		return Object.keys(serialized.dates).length > 0;
	},

	getIndexableFiles(this: EpochPlugin): TFile[] {
		return this.app.vault.getFiles().filter(file => this.shouldIndexFile(file));
	},

	removePathsFromIndex(this: EpochPlugin, paths: string[]): boolean {
		let mutated = false;
		for (const path of paths) {
			if (this.indexer.isFileKnown(path)) {
				this.indexer.removeFile(path);
				mutated = true;
			}
		}
		return mutated;
	}
};
