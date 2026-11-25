import { Notice, Platform, TFile } from "obsidian";
import { TimelineSearchIndex } from "../search/timeline-search-index";
import type { SerializedEpochIndex } from "../indexer/types";
import type { EpochPlugin } from "../main";
import { clearEpochProgress, setEpochProgress } from "./progress";
import { hydrateTimelineSearchIndexFromLoadedState } from "./timeline-search-hydration";
import { bumpTimelineSearchIndexVersion, loadTimelineSearchCache, markTimelineSearchIndexDirty, saveTimelineSearchCache } from "./timeline-search-cache";
import { scheduleTimelineSearchRebuild } from "./search-rebuild-scheduler";
interface IndexOperationOptions { skipEnsure?: boolean; suppressNotices?: boolean; }
export interface IndexingMethods {
	rebuildIndexWithProgress(options?: IndexOperationOptions): Promise<void>;
	refreshIndexSmartWithProgress(options?: IndexOperationOptions): Promise<void>;
	runIndexOperation(mode: "rebuild" | "refresh", options?: IndexOperationOptions): Promise<void>;
	ensureIndexLoaded(): Promise<void>;
	maybeIndexOpenedFile(file: TFile): Promise<void>;
	initializeIndex(): Promise<boolean>;
	loadIndexFromDisk(): Promise<SerializedEpochIndex | undefined>;
	indexHasContent(serialized: SerializedEpochIndex | undefined): boolean;
	getIndexableFiles(): TFile[];
	removePathsFromIndex(paths: string[]): boolean;
}
type Runtime = EpochPlugin & { __epochStartupIndexPromise?: Promise<void>; __epochUnloaded?: boolean; __epochIndexOperationPromise?: Promise<void>; __epochCancelRequestedAt?: { index?: number }; __epochTimelineSearchFocusToken?: number; __epochInheritedMarkStartupScheduled?: boolean; __epochIndexOnOpenInFlight?: Set<string> };
export const indexingMethods: IndexingMethods = {
	async rebuildIndexWithProgress(this: EpochPlugin, options) { await this.runIndexOperation("rebuild", options); },
	async refreshIndexSmartWithProgress(this: EpochPlugin, options) { await this.runIndexOperation("refresh", options); },
	async runIndexOperation(this: EpochPlugin, mode, options = {}) {
		const runtime = this as Runtime;
		if (!options.skipEnsure && runtime.__epochStartupIndexPromise) await runtime.__epochStartupIndexPromise;
		if (runtime.__epochUnloaded) return;
		if (runtime.__epochIndexOperationPromise) return runtime.__epochIndexOperationPromise;
		if (!options.skipEnsure) await this.ensureIndexLoaded();
		if (runtime.__epochIndexOperationPromise) return runtime.__epochIndexOperationPromise;
		this.refreshExcludedMatchers();
		if (this.indexReady) await this.waitForExcludedSync();
		if (!options.skipEnsure) while (this.indexLoadPromise) {
			if (runtime.__epochIndexOperationPromise) return runtime.__epochIndexOperationPromise;
			await this.ensureIndexLoaded();
		}
		if (runtime.__epochIndexOperationPromise) return runtime.__epochIndexOperationPromise;
		const started = Date.now();
		const progress = (processed: number, total: number) => {
			if (options.suppressNotices || Date.now() - started < (Platform.isMobile ? 10000 : 1000)) return;
			if (Platform.isDesktop) setEpochProgress(this, "index", `Indexing… ${processed}/${total}`);
		};
		this.indexReady = false;
		const operation = Promise.resolve().then(async () => {
			const previousSearch = this.timelineSearchIndex;
			this.timelineSearchIndex = new TimelineSearchIndex();
			try {
				try {
					if (mode === "rebuild") await this.indexer.rebuildAll(this.getIndexableFiles(), progress);
					else await this.indexer.reprocessAll(this.getIndexableFiles(), progress);
					if (runtime.__epochUnloaded) throw new Error("EPOCH_CANCELLED");
				} catch (error) {
					this.timelineSearchIndex = previousSearch;
					bumpTimelineSearchIndexVersion(this);
					if (error instanceof Error && error.message === "EPOCH_CANCELLED") return;
					throw error;
				}
				// Computation is complete; committing caches is not cancellable.
				clearEpochProgress(this, "index");
				await this.persist({ skipEnsure: true });
				this.indexReady = true;
				markTimelineSearchIndexDirty(this);
				await saveTimelineSearchCache(this);
				if (mode === "rebuild") runtime.__epochTimelineSearchFocusToken = Number(runtime.__epochTimelineSearchFocusToken ?? 0) + 1;
				if (!options.suppressNotices && !runtime.__epochUnloaded) new Notice(mode === "rebuild" ? "Epochgram index rebuilt" : "Epochgram index refreshed");
			} finally {
				this.indexReady = true;
				if (runtime.__epochCancelRequestedAt) delete runtime.__epochCancelRequestedAt.index;
				clearEpochProgress(this, "index");
				if (!runtime.__epochUnloaded) { this.scheduleInheritedMarkRecompute("index"); this.refreshEpochViews(); }
			}
		});
		this.indexLoadPromise = runtime.__epochIndexOperationPromise = operation;
		try { await operation; }
		finally {
			if (this.indexLoadPromise === operation) this.indexLoadPromise = null;
			if (runtime.__epochIndexOperationPromise === operation) delete runtime.__epochIndexOperationPromise;
		}
	},
	async ensureIndexLoaded(this: EpochPlugin) {
		const runtime = this as Runtime;
		const pending = runtime.__epochStartupIndexPromise ?? this.indexLoadPromise;
		if (pending) await pending;
		if (runtime.__epochUnloaded) return;
		if (!runtime.__epochInheritedMarkStartupScheduled) { runtime.__epochInheritedMarkStartupScheduled = true; this.scheduleInheritedMarkRecompute("startup"); }
	},
	async maybeIndexOpenedFile(this: EpochPlugin, file) {
		if (!file?.path || !this.shouldIndexFile(file)) return;
		const runtime = this as Runtime;
		const pending = runtime.__epochIndexOnOpenInFlight ??= new Set();
		if (pending.has(file.path)) return;
		pending.add(file.path);
		try {
			await this.ensureIndexLoaded(); await this.waitForExcludedSync();
			if (!this.shouldIndexFile(file) || this.indexer.isFileKnown(file.path)) return;
			await this.indexer.processFile(file, { reason: "open" });
			await this.persist({ skipEnsure: true }); this.refreshEpochViews();
		} finally { pending.delete(file.path); }
	},
	async initializeIndex(this: EpochPlugin) {
		try {
			const disk = await this.loadIndexFromDisk();
			await this.indexer.load(disk);
			if (disk && !await loadTimelineSearchCache(this)) {
				hydrateTimelineSearchIndexFromLoadedState(this);
				if (Platform.isDesktop) scheduleTimelineSearchRebuild(this);
			}
			bumpTimelineSearchIndexVersion(this);
			await this.updateIndexFileStat();
			return this.indexHasContent(disk);
		} catch {
			await this.indexer.load(undefined); return false;
		}
	},
	async loadIndexFromDisk(this: EpochPlugin) {
		try {
			if (!await this.app.vault.adapter.exists(this.indexFilePath)) return undefined;
			const parsed = JSON.parse(await this.app.vault.adapter.read(this.indexFilePath)) as SerializedEpochIndex;
			return parsed?.files && parsed?.dates ? parsed : undefined;
		} catch { return undefined; }
	},
	indexHasContent(serialized) { return !!serialized?.dates && Object.keys(serialized.dates).length > 0; },
	getIndexableFiles(this: EpochPlugin) { return this.app.vault.getFiles().filter(file => this.shouldIndexFile(file)); },
	removePathsFromIndex(this: EpochPlugin, paths) {
		let changed = false;
		for (const path of paths) if (this.indexer.isFileKnown(path)) { this.indexer.removeFile(path); changed = true; }
		return changed;
	}
};
