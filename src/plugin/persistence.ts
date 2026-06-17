import { normalizePath } from "obsidian";
import type { SerializedEpochIndex } from "../indexer/types";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
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

export const persistenceMethods: PersistenceMethods = {
	async saveSettings(this: EpochPlugin): Promise<void> {
		await this.savePluginData();
	},

	async clearEpochJsonFilesAndRebuild(this: EpochPlugin): Promise<void> {
		const adapter = this.app.vault.adapter;
		const indexPath = normalizePath(this.indexFilePath);
		const vectorsPath = normalizePath(String((this as any).vectorsFilePath || ""));
		const termPath = normalizePath(String((this as any).termSimilarityFilePath || ""));
		const summariesPath = normalizePath(String((this as any).epochSummariesFilePath || ""));

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
			(this as any).similarityVectorsLoaded = false;
			(this as any).similarityIndex = null;
			(this as any).similarityEmbedder = null;
			(this as any).similarityEmbedderLoadingPromise = null;
			(this as any).termSimilarityIndex = null;
			(this as any).termSimilarityLoaded = false;
			(this as any).termSimilarityStoreRev = 0;
			(this as any).termSimilarityPendingFiles = new Set<string>();
			(this as any).termSimilarityQueueTotal = 0;
			(this as any).termSimilarityQueueProcessed = 0;
		} catch {
			// ignore
		}

		try {
			await (this.indexer as any)?.load?.(undefined);
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
		const diskIndex = normalizeSerializedEpochIndexForDisk(this.indexer.toJSON());
		await this.savePluginData(diskIndex);
		await this.saveCurrentIndexToDisk(diskIndex);
		await saveEpochSummariesToDisk(this);
	},

	async savePluginData(this: EpochPlugin, serializedIndex?: SerializedEpochIndex): Promise<void> {
		void serializedIndex;

		writeLocalActivationState(this, this.settings);
		const syncedSettings = stripLocalActivationState(this.settings);
		const timelineFiltersRaw = (syncedSettings as any).timelineFilters;
		if (timelineFiltersRaw && typeof timelineFiltersRaw === "object") {
			const timelineFilters = { ...(timelineFiltersRaw as Record<string, unknown>) };
			delete (timelineFilters as any).showDraftsOnly;
			(syncedSettings as any).timelineFilters = timelineFilters;
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
		await this.ensurePluginDir();
		const payload = JSON.stringify(serialized);
		try {
			const adapter = this.app.vault.adapter;
			const exists = await adapter.exists(this.indexFilePath);
			if (exists) {
				const current = await adapter.read(this.indexFilePath);
				if (current === payload) {
					await this.updateIndexFileStat();
					return;
				}
			}
		} catch {
			// ignore
		}
		try {
			const root = this.indexFilePath.split("/").slice(0, -1).join("/");
			if (root) {
				await this.app.vault.adapter.mkdir(root);
			}
		} catch {
			// Best-effort; adapter.mkdir may fail if already exists on some backends.
		}
		await this.app.vault.adapter.write(this.indexFilePath, payload);

		await this.updateIndexFileStat();
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
			const p = normalizePath(String((this as any).vectorsFilePath || ""));
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
		(this as any).vectorsFileStat = this.normalizeStat(stat);
	},

	async statTermSimilarityFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const p = normalizePath(String((this as any).termSimilarityFilePath || ""));
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
		(this as any).termSimilarityFileStat = this.normalizeStat(stat);
	},

	async statEpochSummariesFile(this: EpochPlugin): Promise<{ mtime?: number; size?: number } | null> {
		try {
			const p = String((this as any).epochSummariesFilePath ?? "");
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
		(this as any).epochSummariesFileStat = this.normalizeStat(stat);
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
