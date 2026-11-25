import type { SerializedEpochIndex } from "../indexer/types";
import { computeTextHash } from "../utils";
import { currentSettingsSignature, readCurrentSettings } from "../settings-schema";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
import { mergeReviewStatesForSync } from "../indexer/review-state-sync";
import type { EpochSettings } from "../settings";
import type { EpochPlugin } from "../main";
import type { FileStatSnapshot } from "./state";
interface PersistOptions { skipEnsure?: boolean; }
type Stat = { mtime?: number; size?: number } | null;
export interface PersistenceMethods {
	saveSettings(): Promise<void>;
	clearEpochJsonFilesAndRebuild(): Promise<void>;
	persistIndex(options?: PersistOptions): Promise<void>;
	persist(options?: PersistOptions): Promise<void>;
	savePluginData(): Promise<void>;
	saveCurrentIndexToDisk(serialized?: SerializedEpochIndex): Promise<void>;
	writeIndexToDisk(serialized: SerializedEpochIndex): Promise<void>;
	ensurePluginDir(): Promise<void>;
	computeDataSignature(data: unknown): string | null;
	statIndexFile(): Promise<Stat>;
	updateIndexFileStat(): Promise<void>;
	statDataFile(): Promise<Stat>;
	updateDataFileStat(): Promise<void>;
	normalizeStat(stat: Stat): FileStatSnapshot;
	didStatChange(previous: FileStatSnapshot, current: Stat): boolean;
	areSettingsEqual(a: EpochSettings, b: EpochSettings): boolean;
}
async function stat(plugin: EpochPlugin, path: string): Promise<Stat> {
	try { return await plugin.app.vault.adapter.exists(path) ? await plugin.app.vault.adapter.stat(path) : null; } catch { return null; }
}
export const persistenceMethods: PersistenceMethods = {
	async saveSettings(this: EpochPlugin) { await this.savePluginData(); },
	async clearEpochJsonFilesAndRebuild(this: EpochPlugin) {
		// Replace derived data only after a successful rebuild; retain review metadata.
		await this.rebuildIndexWithProgress();
	},
	async persistIndex(this: EpochPlugin, options = {}) { await this.persist(options); },
	async persist(this: EpochPlugin, options = {}) {
		if (!options.skipEnsure) await this.ensureIndexLoaded();
		await this.saveCurrentIndexToDisk();
	},
	async savePluginData(this: EpochPlugin) {
		this.settings = readCurrentSettings(this.settings);
		const payload = { settings: this.settings };
		await this.saveData(payload);
		this.lastDataSignature = this.computeDataSignature(payload);
		this.lastDataSignatureCheck = Date.now(); await this.updateDataFileStat();
	},
	async saveCurrentIndexToDisk(this: EpochPlugin, serialized) { await this.writeIndexToDisk(serialized ?? this.indexer.toJSON()); },
	async writeIndexToDisk(this: EpochPlugin, serialized) {
		const runtime = this as EpochPlugin & { __epochIndexWriteQueue?: Promise<void>; lastIndexDiskSignature?: string };
		const sourceRevision = this.indexer.revision;
		const previous = runtime.__epochIndexWriteQueue ?? Promise.resolve();
		const run = previous.catch(() => {}).then(async () => {
			await this.ensurePluginDir();
			const adapter = this.app.vault.adapter;
			const readCurrent = async () => {
				for (let attempt = 0; ; attempt++) {
					try { return await adapter.exists(this.indexFilePath) ? await adapter.read(this.indexFilePath) : ""; }
					catch (error) { if (attempt >= 2) throw error; }
				}
			};
			for (let attempt = 0; attempt < 4; attempt++) {
				const revision = this.indexer.revision;
				const current = await readCurrent();
				const snapshot = normalizeSerializedEpochIndexForDisk(attempt || sourceRevision !== revision || revision !== this.indexer.revision ? this.indexer.toJSON() : serialized);
				try {
					const disk = current ? JSON.parse(current) as SerializedEpochIndex : null;
					if (disk?.files && disk?.dates) mergeReviewStatesForSync(snapshot, disk);
				} catch { /* A malformed current cache is rebuilt, not migrated. */ }
				mergeReviewStatesForSync(snapshot, this.indexer.toJSON());
				// The adapter has no compare-and-swap; retry if a Sync/local update is observed.
				if (await readCurrent() !== current || this.indexer.revision !== revision) continue;
				const payload = JSON.stringify(normalizeSerializedEpochIndexForDisk(snapshot));
				if (current !== payload) await adapter.write(this.indexFilePath, payload);
				runtime.lastIndexDiskSignature = computeTextHash(payload);
				const changedDuringWrite = this.indexer.revision !== revision;
				if (this.indexer.mergeReviewStates(snapshot)) this.refreshEpochViews();
				const mergedRevision = this.indexer.revision;
				if (changedDuringWrite || await readCurrent() !== payload || this.indexer.revision !== mergedRevision) continue;
				await this.updateIndexFileStat();
				return;
			}
			throw new Error("Epochgram: Index changed during persistence; retry the operation.");
		});
		runtime.__epochIndexWriteQueue = run;
		try { await run; } finally { if (runtime.__epochIndexWriteQueue === run) delete runtime.__epochIndexWriteQueue; }
	},
	async ensurePluginDir(this: EpochPlugin) {
		if (this.pluginDirEnsured) return;
		if (!await this.app.vault.adapter.exists(this.pluginDirPath)) await this.app.vault.adapter.mkdir(this.pluginDirPath);
		this.pluginDirEnsured = true;
	},
	computeDataSignature(data) { return currentSettingsSignature(data); },
	async statIndexFile(this: EpochPlugin) { return stat(this, this.indexFilePath); },
	async updateIndexFileStat(this: EpochPlugin) { this.indexFileStat = this.normalizeStat(await this.statIndexFile()); },
	async statDataFile(this: EpochPlugin) { return stat(this, this.dataFilePath); },
	async updateDataFileStat(this: EpochPlugin) { this.dataFileStat = this.normalizeStat(await this.statDataFile()); },
	normalizeStat(value) { return { mtime: value?.mtime ?? null, size: value?.size ?? null }; },
	didStatChange(previous, current) { return previous.mtime !== (current?.mtime ?? null) || previous.size !== (current?.size ?? null); },
	areSettingsEqual(a, b) { return JSON.stringify(readCurrentSettings(a)) === JSON.stringify(readCurrentSettings(b)); }
};
