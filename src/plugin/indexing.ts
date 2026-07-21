import { Notice, Platform, TFile } from "obsidian";
import type { SerializedEpochIndex } from "../indexer/types";
import type { EpochPlugin } from "../main";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
import { sortIndex } from "../indexer/indexer-utils";
import { updateAggregatedEntriesInternal } from "../indexer/update-aggregated-entries";
import type { IndexerPipeline } from "../indexer/pipeline";
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
import { getYamlPropertyForFile, setYamlPropertyForFile } from "./note-frontmatter";
import { getEpochMarkColorSet } from "../ui/mark-colors";

interface IndexOperationOptions {
	skipEnsure?: boolean;
	suppressNotices?: boolean;
	baseline?: boolean;
}

interface RefreshOptions {
	skipEnsure?: boolean;
	suppressNotices?: boolean;
}

type IndexingPluginState = EpochPlugin & {
	indexOperationStartedAt?: number;
	timelineSearchIndex?: { clear?: () => void };
	indexReady: boolean;
	indexLoadPromise: Promise<void> | null;
	__epochCancelRequestedAt?: { index?: number };
	__epochTimelineSearchFocusToken?: number;
	__epochInheritedMarkStartupScheduled?: boolean;
	__epochInheritedMarkComputedAt?: number;
	__epochInheritedMarkIndexByPath?: Map<string, number>;
	__epochIndexOnOpenInFlight?: Set<string>;
	queueVectorUpdate?: (path: string) => void;
	queueTermSimilarityUpdate?: (path: string) => void;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
	__timelineSearchAutoRebuildScheduled?: boolean;
	rebuildTimelineSearchIndex?: () => Promise<void>;
	settings: EpochPlugin["settings"] & { completedMigrations?: string[] };
};

const FRONTMATTER_SYNC_MIGRATION_ID = "1.7.0-frontmatter-pin-mark-sync";

function hasCompletedMigration(state: IndexingPluginState, migrationId: string): boolean {
	try {
		const list = Array.isArray(state.settings.completedMigrations)
			? state.settings.completedMigrations
			: [];
		if (list.includes(migrationId)) return true;
	} catch {
		// ignore
	}
	return false;
}

async function markMigrationCompleted(plugin: EpochPlugin, migrationId: string): Promise<void> {
	const state = plugin as IndexingPluginState;
	try {
		const existing = Array.isArray(state.settings.completedMigrations)
			? state.settings.completedMigrations.filter((id) => typeof id === "string" && id.trim().length > 0)
			: [];
		if (!existing.includes(migrationId)) existing.push(migrationId);
		state.settings.completedMigrations = existing;
		await plugin.saveSettings();
	} catch {
		// ignore
	}
}

async function reapplySavedAiSummaries(plugin: EpochPlugin): Promise<void> {
	try {
		const loaded = await loadEpochSummariesFromDisk(plugin);
		applyAiSummaries(plugin, loaded.aiSummaries);
	} catch {
		// ignore
	}
}

function recomputeSummariesAfterAiRehydrate(plugin: EpochPlugin): void {
	try {
		const paths = plugin.indexer.getIndexedPaths();
		for (const p of paths) {
			try {
				updateAggregatedEntriesInternal(plugin.indexer as unknown as IndexerPipeline, p, { skipSort: true });
			} catch {
				// ignore per-file failures
			}
		}
		plugin.indexer.index = sortIndex(plugin.indexer.index);
	} catch {
		// ignore
	}
}

async function migrateIndexedFrontmatterOnce(plugin: EpochPlugin): Promise<boolean> {
	const state = plugin as IndexingPluginState;
	if (hasCompletedMigration(state, FRONTMATTER_SYNC_MIGRATION_ID)) return false;

	let didSomething = false;
	let completed = false;
	const files = plugin.indexer.toJSON().files ?? {};
	const root = plugin.app?.workspace?.containerEl ?? null;
	const markColors = getEpochMarkColorSet(root);
	for (const [path, data] of Object.entries(files)) {
		try {
			const file = plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			const pinMode = typeof data?.pinnedFile === "string" ? data.pinnedFile : "";
			if (pinMode) {
				const current = await getYamlPropertyForFile(plugin, file, "pin");
				if (!String(current || "").trim()) {
					didSomething = (await setYamlPropertyForFile(plugin, file, "pin", pinMode)) || didSomething;
				}
			}

			const markHex = String(data?.markColorHex || "").trim() || (() => {
				const idx = Number(data?.markColor ?? 0);
				return Number.isFinite(idx) && idx > 0 ? String(markColors[idx - 1] || "").trim() : "";
			})();
			if (markHex) {
				const current = await getYamlPropertyForFile(plugin, file, "mark");
				if (!String(current || "").trim()) {
					didSomething = (await setYamlPropertyForFile(plugin, file, "mark", markHex)) || didSomething;
				}
			}

		} catch {
			// ignore per-file migration failures
		}
	}
	completed = true;

	if (completed) {
		await markMigrationCompleted(plugin, FRONTMATTER_SYNC_MIGRATION_ID);
	}

	return didSomething;
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
		const state = this as IndexingPluginState;
		const { skipEnsure = false, suppressNotices = false, baseline = false } = options;
		if (mode === "refresh" && suppressNotices) {
			return;
		}
		// Track operation start so progress notices don't fire immediately.
		try {
			state.indexOperationStartedAt = Date.now();
		} catch {
			// ignore
		}
		if (!skipEnsure) {
			await this.ensureIndexLoaded();
		}
		try {
			state.timelineSearchIndex?.clear?.();
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
		const progressLabel = mode === "rebuild" ? "Indexing…" : "Indexing…";
		const successLabel = mode === "rebuild" ? "Epochgram index rebuilt" : "Epochgram index refreshed";
		if (!suppressNotices && Platform.isDesktop) {
			announceEpochDesktopTaskAfter(this, `index:${mode}:start`, mode === "rebuild" ? "Epochgram indexing started" : "Epochgram refresh started", {
				graceMs: 1000,
				still: () => {
					try {
						return !state.indexReady || !!state.indexLoadPromise;
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
						const v = Number(state.indexOperationStartedAt ?? 0);
						return Number.isFinite(v) ? v : 0;
					} catch {
						return 0;
					}
				})();
				// Avoid showing progress for very fast operations.
				const graceMs = Platform.isMobile ? 10000 : 1000;
				if (startedAt > 0 && now - startedAt < graceMs) return;
				const minMs = Platform.isMobile ? 10000 : 1000;
				if (now - this.lastRebuildNoticeAt > minMs) {
					this.lastRebuildNoticeAt = now;
					if (Platform.isDesktop) {
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

		const isCancelledError = (e: unknown): boolean => {
			try {
				const err = e as { code?: unknown; message?: unknown };
				const code = typeof err?.code === "string" ? err.code : "";
				const message = typeof err?.message === "string" ? err.message : "";
				return code === "EPOCH_CANCELLED" || message === "EPOCH_CANCELLED";
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
		state.indexReady = false;

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
			if (mode === "rebuild") {
				try {
					await migrateIndexedFrontmatterOnce(this);
				} catch {
					// ignore
				}
			}
			await this.persist({ skipEnsure: true });
		} finally {
			state.indexReady = true;
			state.indexLoadPromise = null;
			try {
				if (state.__epochCancelRequestedAt) {
					delete state.__epochCancelRequestedAt.index;
				}
			} catch {
				// ignore
			}
			try {
				if (Platform.isDesktop) {
					cancelEpochDesktopTaskAnnouncement(this, `index:${mode}:start`);
				}
			} catch {
				// ignore
			}
			if (!suppressNotices && Platform.isDesktop) {
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
					state.__epochTimelineSearchFocusToken = Number(state.__epochTimelineSearchFocusToken ?? 0) + 1;
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

		await reapplySavedAiSummaries(this);
		recomputeSummariesAfterAiRehydrate(this);

		try {
			if (mode === "rebuild") {
				state.__epochTimelineSearchFocusToken = Number(state.__epochTimelineSearchFocusToken ?? 0) + 1;
			}
		} catch {
			// ignore
		}

		this.refreshEpochViews();
	},

	async ensureIndexLoaded(this: EpochPlugin): Promise<void> {
		const state = this as IndexingPluginState;
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
			if (state.__epochInheritedMarkStartupScheduled === true) return;
			const computedAtRaw = Number(state.__epochInheritedMarkComputedAt ?? 0);
			const computedAt = Number.isFinite(computedAtRaw) ? computedAtRaw : 0;
			if (computedAt > 0 && state.__epochInheritedMarkIndexByPath instanceof Map) return;
			state.__epochInheritedMarkStartupScheduled = true;
			state.scheduleInheritedMarkRecompute?.("startup");
		} catch {
			// ignore
		}
	},

	async maybeIndexOpenedFile(this: EpochPlugin, file: TFile): Promise<void> {
		try {
			const state = this as IndexingPluginState;
			if (!file?.path) return;
			if (!this.shouldIndexFile(file)) return;
			if (this.indexer.isFileKnown(file.path)) return;

			if (!(state.__epochIndexOnOpenInFlight instanceof Set)) {
				state.__epochIndexOnOpenInFlight = new Set<string>();
			}
			const inFlight: Set<string> = state.__epochIndexOnOpenInFlight;
			if (inFlight.has(file.path)) return;
			inFlight.add(file.path);

			try {
				// Give Obsidian a moment to finish writing the file on startup/mobile.
				const delayMs = Platform.isMobile ? 350 : 75;
				await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				if (!this.indexReady) return;
				if (!this.shouldIndexFile(file)) return;
				if (this.indexer.isFileKnown(file.path)) return;

				await this.indexer.processFile(file, { reason: "open" });
				await this.persist({ skipEnsure: true });
				try {
					state.queueVectorUpdate?.(file.path);
				} catch {
					// ignore
				}
				try {
					state.queueTermSimilarityUpdate?.(file.path);
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
							const state = this as IndexingPluginState;
							if (state.__timelineSearchAutoRebuildScheduled !== true && Platform.isDesktop) {
								state.__timelineSearchAutoRebuildScheduled = true;
								window.setTimeout(() => {
									try {
										void state.rebuildTimelineSearchIndex?.();
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
