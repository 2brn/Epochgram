import { normalizePath } from "obsidian";
import type { SerializedEpochIndex } from "../indexer/types";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
import { mergeReviewStatesForSync } from "../indexer/review-state-sync";
import type { EpochSettings } from "../settings";
import type { EpochPlugin } from "../main";
import { saveEpochSummariesToDisk } from "./ai-summaries/epoch-summaries-store";
import {
	mergeSyncedSettingsWithLocalActivation,
	readLocalActivationState,
	stripLocalActivationState,
	writeLocalActivationState
} from "./local-activation-state";

interface PersistOptions {
	skipEnsure?: boolean;
}

type PersistencePluginState = {
	vectorsFilePath?: string;
	termSimilarityFilePath?: string;
	epochSummariesFilePath?: string;
	similarityVectorsLoaded?: boolean;
	similarityIndex?: unknown;
	similarityEmbedder?: unknown;
	similarityEmbedderLoadingPromise?: unknown;
	termSimilarityIndex?: unknown;
	termSimilarityLoaded?: boolean;
	termSimilarityStoreRev?: number;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	vectorsFileStat?: { mtime: number | null; size: number | null };
	termSimilarityFileStat?: { mtime: number | null; size: number | null };
	epochSummariesFileStat?: { mtime: number | null; size: number | null };
	__epochIndexWriteQueue?: Promise<void> | null;
};

export interface PersistenceMethods {
	saveSettings(): Promise<void>;
	clearEpochJsonFilesAndRebuild(): Promise<void>;
	persistIndex(options?: PersistOptions): Promise<void>;
	persist(options?: PersistOptions): Promise<void>;
	savePluginData(serializedIndex?: SerializedEpochIndex): Promise<void>;
	saveCurrentIndexToDisk(serialized?: SerializedEpochIndex): Promise<void>;
	writeIndexToDisk(serialized: SerializedEpochIndex): Promise<void>;
	ensurePluginDir(): Promise<void>;
	computeDataSignature(data: unknown): string | null;
	statIndexFile(): Promise<{ mtime?: number; size?: number } | null>;
	updateIndexFileStat(): Promise<void>;
	statDataFile(): Promise<{ mtime?: number; size?: number } | null>;
	updateDataFileStat(): Promise<void>;
	statVectorsFile(): Promise<{ mtime?: number; size?: number } | null>;
	updateVectorsFileStat(): Promise<void>;
	statTermSimilarityFile(): Promise<{ mtime?: number; size?: number } | null>;
	updateTermSimilarityFileStat(): Promise<void>;
	statEpochSummariesFile(): Promise<{ mtime?: number; size?: number } | null>;
	updateEpochSummariesFileStat(): Promise<void>;
	normalizeStat(stat: { mtime?: number; size?: number } | null): { mtime: number | null; size: number | null };
	didStatChange(
		previous: { mtime: number | null; size: number | null },
		current: { mtime?: number; size?: number } | null
	): boolean;
	areSettingsEqual(a: EpochSettings, b: EpochSettings): boolean;
}

type IndexerLoader = {
	load?: (index: SerializedEpochIndex) => Promise<void> | void;
	toJSON?: () => SerializedEpochIndex;
};

async function writeIndexToDiskNow(plugin: EpochPlugin, serialized: SerializedEpochIndex): Promise<void> {
	await plugin.ensurePluginDir();
	const adapter = plugin.app.vault.adapter;
	try {
		const root = plugin.indexFilePath.split("/").slice(0, -1).join("/");
		if (root) await adapter.mkdir(root);
	} catch {
		// Best-effort; adapter.mkdir may fail if the directory already exists.
	}

	let next = normalizeSerializedEpochIndexForDisk(serialized);
	let payload = JSON.stringify(next);
	const localPayload = payload;
	let shouldLoadMergedIndex = false;

	const mergeCurrentDiskIndex = (raw: string): void => {
		if (raw === payload) return;
		try {
			const incoming = normalizeSerializedEpochIndexForDisk(JSON.parse(raw) as SerializedEpochIndex);
			if (!mergeReviewStatesForSync(next, incoming)) return;
			next = normalizeSerializedEpochIndexForDisk(next);
			payload = JSON.stringify(next);
			shouldLoadMergedIndex = true;
		} catch {
			// Keep the local index when the on-disk file is incomplete during Sync.
		}
	};

	let writeNeeded = true;
	try {
		const exists = await adapter.exists(plugin.indexFilePath);
		if (exists) {
			// Read twice: an incoming Sync replacement that lands while the first
			// copy is being reconciled is observed by the final read immediately
			// before write. There is intentionally no await between that final read
			// and adapter.write below.
			for (let attempt = 0; attempt < 2; attempt++) {
				const current = await adapter.read(plugin.indexFilePath);
				mergeCurrentDiskIndex(current);
				if (current === payload) {
					writeNeeded = false;
					break;
				}
				if (attempt === 1) break;
			}
		}
	} catch {
		// A failed read must not prevent a local index write.
	}

	if (writeNeeded) {
		await adapter.write(plugin.indexFilePath, payload);
	}

	if (shouldLoadMergedIndex) {
		const indexer = plugin.indexer as unknown as IndexerLoader;
		try {
			const livePayload = typeof indexer.toJSON === "function"
				? JSON.stringify(normalizeSerializedEpochIndexForDisk(indexer.toJSON()))
				: localPayload;
			if (livePayload === localPayload) await indexer.load?.(next);
		} catch {
			// The disk write is still valid if the live index changed concurrently.
		}
	}

	await plugin.updateIndexFileStat();
}

export const persistenceMethods: PersistenceMethods = {
	async saveSettings(this: EpochPlugin): Promise<void> {
		await this.savePluginData();
	},

	async clearEpochJsonFilesAndRebuild(this: EpochPlugin): Promise<void> {
		const state = this as EpochPlugin & PersistencePluginState;
		const adapter = this.app.vault.adapter;
		const indexPath = normalizePath(this.indexFilePath);
		const vectorsPath = normalizePath(String(state.vectorsFilePath || ""));
		const termPath = normalizePath(String(state.termSimilarityFilePath || ""));
		const summariesPath = normalizePath(String(state.epochSummariesFilePath || ""));

		const removeIfExists = async (p: string): Promise<void> => {
			if (!p) return;
			try {
				const exists = await adapter.exists(p);
				if (!exists) return;
				await adapter.remove(p);
			} catch {
				// ignore
			}
		};

		await removeIfExists(indexPath);
		await removeIfExists(termPath);
		await removeIfExists(vectorsPath);
		await removeIfExists(summariesPath);

		try {
			state.similarityVectorsLoaded = false;
			state.similarityIndex = null;
			state.similarityEmbedder = null;
			state.similarityEmbedderLoadingPromise = null;
			state.termSimilarityIndex = null;
			state.termSimilarityLoaded = false;
			state.termSimilarityStoreRev = 0;
			state.termSimilarityPendingFiles = new Set<string>();
			state.termSimilarityQueueTotal = 0;
			state.termSimilarityQueueProcessed = 0;
		} catch {
			// ignore
		}

		try {
			await (this.indexer as { load?: (arg?: unknown) => Promise<void> | void })?.load?.(undefined);
		} catch {
			// ignore
		}

		await this.updateIndexFileStat();
		await this.updateTermSimilarityFileStat();
		await this.updateVectorsFileStat();
		await this.updateEpochSummariesFileStat();

		await this.rebuildIndexWithProgress({ skipEnsure: true, baseline: true });
	},

	async persistIndex(this: EpochPlugin, options: PersistOptions = {}): Promise<void> {
		await this.persist(options);
	},

	async persist(this: EpochPlugin, options: PersistOptions = {}): Promise<void> {
		if (!options.skipEnsure) {
			await this.ensureIndexLoaded();
		}
		await this.savePluginData();
		// saveData() yields; capture only after it completes so an external Sync
		// reload cannot be overwritten by a snapshot taken before that reload.
		const diskIndex = normalizeSerializedEpochIndexForDisk(this.indexer.toJSON());
		await this.saveCurrentIndexToDisk(diskIndex);
		await saveEpochSummariesToDisk(this);
	},

	async savePluginData(this: EpochPlugin, serializedIndex?: SerializedEpochIndex): Promise<void> {
		void serializedIndex;

		writeLocalActivationState(this, this.settings);
		const syncedSettings = stripLocalActivationState(this.settings);
		const syncedSettingsState = syncedSettings as EpochSettings & {
			timelineFilters?: Record<string, unknown>;
		};
		const timelineFiltersRaw = syncedSettingsState.timelineFilters;
		if (timelineFiltersRaw && typeof timelineFiltersRaw === "object") {
			const timelineFilters = { ...(timelineFiltersRaw as Record<string, unknown>) };
			delete timelineFilters.showDraftsOnly;
			syncedSettingsState.timelineFilters = timelineFilters;
		}
		const payload = {
			settings: (() => {
				return { ...syncedSettings };
			})(),
		};

		const signature = this.computeDataSignature(payload);
		await this.saveData(payload);
		this.lastDataSignature = signature;
		this.lastDataSignatureCheck = Date.now();
		await this.updateDataFileStat();
	},

	async saveCurrentIndexToDisk(this: EpochPlugin, serialized?: SerializedEpochIndex): Promise<void> {
		const payload = serialized ?? this.indexer.toJSON();
		await this.writeIndexToDisk(payload);
	},

	async writeIndexToDisk(this: EpochPlugin, serialized: SerializedEpochIndex): Promise<void> {
		const state = this as EpochPlugin & PersistencePluginState;
		const previous = state.__epochIndexWriteQueue ?? Promise.resolve();
		const run = previous
			.catch(() => {
				// A failed earlier write must not block later persistence.
			})
			.then(() => writeIndexToDiskNow(this, serialized));
		state.__epochIndexWriteQueue = run;
		try {
			await run;
		} finally {
			if (state.__epochIndexWriteQueue === run) state.__epochIndexWriteQueue = null;
		}
	},

	async ensurePluginDir(this: EpochPlugin): Promise<void> {
		if (this.pluginDirEnsured) return;
		try {
			const exists = await this.app.vault.adapter.exists(this.pluginDirPath);
			if (!exists) {
				await this.app.vault.adapter.mkdir(this.pluginDirPath);
			}
			this.pluginDirEnsured = true;
		} catch { void 0; }
	},

	computeDataSignature(_data: unknown): string | null {
		const data = _data;
		if (data === undefined) return null;
		try {
			return JSON.stringify(data);
		} catch {
			return null;
		}
	},

	async statIndexFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const exists = await this.app.vault.adapter.exists(this.indexFilePath);
			if (!exists) return null;
			return await this.app.vault.adapter.stat(this.indexFilePath);
		} catch (error) {
			void error;
			return null;
		}
	},

	async updateIndexFileStat(this: EpochPlugin): Promise<void> {
		const stat = await this.statIndexFile();
		this.indexFileStat = this.normalizeStat(stat);
	},

	async statDataFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const exists = await this.app.vault.adapter.exists(this.dataFilePath);
			if (!exists) return null;
			return await this.app.vault.adapter.stat(this.dataFilePath);
		} catch (error) {
			void error;
			return null;
		}
	},

	async updateDataFileStat(this: EpochPlugin): Promise<void> {
		const stat = await this.statDataFile();
		this.dataFileStat = this.normalizeStat(stat);
	},

	async statVectorsFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const p = normalizePath(String((this as EpochPlugin & PersistencePluginState).vectorsFilePath || ""));
			if (!p) return null;
			const exists = await this.app.vault.adapter.exists(p);
			if (!exists) return null;
			return await this.app.vault.adapter.stat(p);
		} catch (error) {
			void error;
			return null;
		}
	},

	async updateVectorsFileStat(this: EpochPlugin): Promise<void> {
		const stat = await this.statVectorsFile();
		(this as EpochPlugin & PersistencePluginState).vectorsFileStat = this.normalizeStat(stat);
	},

	async statTermSimilarityFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const p = normalizePath(String((this as EpochPlugin & PersistencePluginState).termSimilarityFilePath || ""));
			if (!p) return null;
			const exists = await this.app.vault.adapter.exists(p);
			if (!exists) return null;
			return await this.app.vault.adapter.stat(p);
		} catch (error) {
			void error;
			return null;
		}
	},

	async updateTermSimilarityFileStat(this: EpochPlugin): Promise<void> {
		const stat = await this.statTermSimilarityFile();
		(this as EpochPlugin & PersistencePluginState).termSimilarityFileStat = this.normalizeStat(stat);
	},

	async statEpochSummariesFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const p = String((this as EpochPlugin & PersistencePluginState).epochSummariesFilePath ?? "");
			if (!p) return null;
			const exists = await this.app.vault.adapter.exists(p);
			if (!exists) return null;
			return await this.app.vault.adapter.stat(p);
		} catch (error) {
			void error;
			return null;
		}
	},

	async updateEpochSummariesFileStat(this: EpochPlugin): Promise<void> {
		const stat = await this.statEpochSummariesFile();
		(this as EpochPlugin & PersistencePluginState).epochSummariesFileStat = this.normalizeStat(stat);
	},

	normalizeStat(_stat: { mtime?: number; size?: number } | null): { mtime: number | null; size: number | null } {
		const stat = _stat;
		if (!stat) {
			return { mtime: null, size: null };
		}
		return {
			mtime: typeof stat.mtime === "number" ? stat.mtime : null,
			size: typeof stat.size === "number" ? stat.size : null
		};
	},

	didStatChange(
		this: EpochPlugin,
		previous: { mtime: number | null; size: number | null },
		current: { mtime?: number; size?: number } | null
	): boolean {
		const next = this.normalizeStat(current);
		return previous.mtime !== next.mtime || previous.size !== next.size;
	},

	areSettingsEqual(a: EpochSettings, b: EpochSettings): boolean {
		const left = mergeSyncedSettingsWithLocalActivation(stripLocalActivationState(a), readLocalActivationState(this));
		const right = mergeSyncedSettingsWithLocalActivation(stripLocalActivationState(b), readLocalActivationState(this));
		return JSON.stringify(left) === JSON.stringify(right);
	}
};
