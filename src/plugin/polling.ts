import { DEFAULT_SETTINGS } from "../settings";
import type { PersistedPluginData } from "./state";
import type { EpochPlugin } from "../main";
import { normalizeSerializedEpochIndexForDisk } from "../indexer/disk-serialization";
import {
	applyAiSummaries,
	applyEpochEntriesByDate,
	loadEpochSummariesFromDisk
} from "./ai-summaries/epoch-summaries-store";
import {
	mergeSyncedSettingsWithLocalActivation,
	readLocalActivationState
} from "./local-activation-state";
import { isTrackChangesEffective } from "./pro-feature-state";

function fastStringSignature(input: string): string {
	const s = input ?? "";
	let hash = 5381;
	for (let i = 0; i < s.length; i++) {
		hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
		hash |= 0;
	}
	return `${s.length}:${hash}`;
}

interface PollOptions {
	forceIndex?: boolean;
	forceData?: boolean;
	forceVectors?: boolean;
	forceTermSimilarity?: boolean;
	forceEpochSummaries?: boolean;
}

export interface PollingMethods {
	pollExternalIndexChanges(options?: PollOptions): Promise<void>;
	reloadIndexFromDisk(): Promise<void>;
	reloadIndexFromPluginData(): Promise<void>;
}

export const pollingMethods: PollingMethods = {
	async pollExternalIndexChanges(this: EpochPlugin, options: PollOptions = {}): Promise<void> {
		const {
			forceIndex = false,
			forceData = false,
			forceVectors = false,
			forceTermSimilarity = false,
			forceEpochSummaries = false
		} = options;
		if (this.indexPollInFlight) return;
		if (this.indexLoadPromise) return;
		if (!this.indexReady) return;
		this.indexPollInFlight = true;
		try {
			this.refreshExcludedMatchers();
			await this.waitForExcludedSync();
			const [indexStat, dataStat, vectorsStat, termStat, epochSummariesStat] = await Promise.all([
				this.statIndexFile(),
				this.statDataFile(),
				this.statVectorsFile(),
				(this as any).statTermSimilarityFile?.(),
				(this as any).statEpochSummariesFile?.()
			]);
			let indexChanged = forceIndex || this.didStatChange(this.indexFileStat, indexStat);
			const dataChanged = forceData || this.didStatChange(this.dataFileStat, dataStat);
			let vectorsChanged = forceVectors || this.didStatChange((this as any).vectorsFileStat ?? { mtime: null, size: null }, vectorsStat);
			let termChanged =
				forceTermSimilarity ||
				this.didStatChange((this as any).termSimilarityFileStat ?? { mtime: null, size: null }, termStat);
			let epochSummariesChanged =
				forceEpochSummaries ||
				this.didStatChange((this as any).epochSummariesFileStat ?? { mtime: null, size: null }, epochSummariesStat);
			const now = Date.now();

			const normalizedIndexStat = this.normalizeStat(indexStat);
			const normalizedVectorsStat = this.normalizeStat(vectorsStat);
			const normalizedTermStat = this.normalizeStat(termStat);
			const normalizedEpochSummariesStat = this.normalizeStat(epochSummariesStat);
			void normalizedIndexStat;
			void normalizedVectorsStat;
			void normalizedTermStat;
			void normalizedEpochSummariesStat;

			// Some mobile vault adapters may not provide reliable mtime/size signals for sync changes.
			// Fall back to periodic content checks.
			const shouldForceIndexContentCheck = !indexChanged && now - (this as any).lastIndexContentCheckAt > 60000;
			const shouldForceVectorsContentCheck = !vectorsChanged && now - (this as any).lastVectorsContentCheckAt > 60000;
			const shouldForceTermContentCheck = !termChanged && now - (this as any).lastTermSimilarityContentCheckAt > 60000;
			const shouldForceEpochSummariesContentCheck =
				!epochSummariesChanged && now - (this as any).lastEpochSummariesContentCheckAt > 60000;

			// Content signature check: catches sync updates where mtime/size do not change.
			if (shouldForceIndexContentCheck) {
				(this as any).lastIndexContentCheckAt = now;
				try {
					const exists = await this.app.vault.adapter.exists(this.indexFilePath);
					const raw = exists ? await this.app.vault.adapter.read(this.indexFilePath) : "";
					const sig = fastStringSignature(raw);
					const prev = String((this as any).lastIndexDiskSignature ?? "");
					(this as any).lastIndexDiskSignature = sig;
					if (prev && prev !== sig) {
						indexChanged = true;
					}
				} catch {
					// ignore
				}
			}

			if (shouldForceVectorsContentCheck) {
				(this as any).lastVectorsContentCheckAt = now;
				try {
					const vectorsPath = String((this as any).vectorsFilePath ?? "");
					if (vectorsPath) {
						const exists = await this.app.vault.adapter.exists(vectorsPath);
						const raw = exists ? await this.app.vault.adapter.read(vectorsPath) : "";
						const sig = fastStringSignature(raw);
						const prev = String((this as any).lastVectorsDiskSignature ?? "");
						(this as any).lastVectorsDiskSignature = sig;
						if (prev && prev !== sig) {
							vectorsChanged = true;
						}
					}
				} catch {
					// ignore
				}
			}

			if (shouldForceTermContentCheck) {
				(this as any).lastTermSimilarityContentCheckAt = now;
				try {
					const termPath = String((this as any).termSimilarityFilePath ?? "");
					if (termPath) {
						const exists = await this.app.vault.adapter.exists(termPath);
						const raw = exists ? await this.app.vault.adapter.read(termPath) : "";
						const sig = fastStringSignature(raw);
						const prev = String((this as any).lastTermSimilarityDiskSignature ?? "");
						(this as any).lastTermSimilarityDiskSignature = sig;
						if (prev && prev !== sig) {
							termChanged = true;
						}
					}
				} catch {
					// ignore
				}
			}

			if (shouldForceEpochSummariesContentCheck) {
				(this as any).lastEpochSummariesContentCheckAt = now;
				try {
					const p = String((this as any).epochSummariesFilePath ?? "");
					if (p) {
						const exists = await this.app.vault.adapter.exists(p);
						const raw = exists ? await this.app.vault.adapter.read(p) : "";
						const sig = fastStringSignature(raw);
						const prev = String((this as any).lastEpochSummariesDiskSignature ?? "");
						(this as any).lastEpochSummariesDiskSignature = sig;
						if (prev && prev !== sig) {
							epochSummariesChanged = true;
						}
					}
				} catch {
					// ignore
				}
			}

			const shouldCheckPluginData =
				indexChanged ||
				dataChanged ||
				forceData ||
				now - this.lastDataSignatureCheck > 60000;

			if (indexChanged) {
				await this.reloadIndexFromDisk();
			}

			if (vectorsChanged) {
				try {
					await (this as any).reloadVectorsFromDisk?.();
				} catch {
					// ignore
				}
			}

			if (termChanged) {
				try {
					await (this as any).reloadTermSimilaritiesFromDisk?.();
				} catch {
					// ignore
				}
			}

			if (epochSummariesChanged) {
				try {
					const loaded = await loadEpochSummariesFromDisk(this);
					applyEpochEntriesByDate(this, loaded.epochsByDate);
					applyAiSummaries(this, loaded.aiSummaries);
					this.refreshEpochViews();
				} catch {
					// ignore
				}
			}

			if (shouldCheckPluginData) {
				await this.reloadIndexFromPluginData();
			}

			this.indexFileStat = normalizedIndexStat;
			this.dataFileStat = this.normalizeStat(dataStat);
			(this as any).vectorsFileStat = normalizedVectorsStat;
			(this as any).termSimilarityFileStat = normalizedTermStat;
			(this as any).epochSummariesFileStat = normalizedEpochSummariesStat;
		} catch (error) {
			void error;
		} finally {
			this.indexPollInFlight = false;
		}
	},

	async reloadIndexFromDisk(this: EpochPlugin): Promise<void> {
		try {
			const diskIndex = await this.loadIndexFromDisk();
			if (!diskIndex) {
				await this.updateIndexFileStat();
				return;
			}
			const sanitized = normalizeSerializedEpochIndexForDisk(diskIndex);
			await this.indexer.load(sanitized);
			try {
				const loaded = await loadEpochSummariesFromDisk(this);
				applyEpochEntriesByDate(this, loaded.epochsByDate);
				applyAiSummaries(this, loaded.aiSummaries);
			} catch {
				// ignore
			}
			// The index can change due to sync without any local mutation hooks firing.
			// Inherited mark caches depend on the marked seed set; invalidate + recompute
			// so cleared marks (unmark) reflect immediately on other devices.
			try {
				(this as any).scheduleInheritedMarkRecompute?.("index-disk-reload");
			} catch {
				// ignore
			}
			this.indexReady = true;
			await this.updateIndexFileStat();
			this.refreshEpochViews();
			void this.ensureExcludedSync();
		} catch (error) {
			void error;
		}
	},

	async reloadIndexFromPluginData(this: EpochPlugin): Promise<void> {
		let indexUpdated = false;
		let settingsChanged = false;
		try {
			const saved = (await this.loadData()) as PersistedPluginData | null;
			const signature = this.computeDataSignature(saved);
			if (signature === this.lastDataSignature) {
				return;
			}
			this.lastDataSignature = signature;
			if (!saved) {
				return;
			}

			if (saved.settings) {
				const nextSettings = Object.assign(
					{},
					DEFAULT_SETTINGS,
					mergeSyncedSettingsWithLocalActivation(saved.settings, readLocalActivationState(this))
				);
				const previousTrackChanges = isTrackChangesEffective(this);
				if (!this.areSettingsEqual(this.settings, nextSettings)) {
					this.settings = nextSettings;
					settingsChanged = true;
				}
				if (previousTrackChanges !== isTrackChangesEffective(this)) {
					this.registerFileEvents();
				}
			}
		} catch (error) {
			void error;
		} finally {
			this.lastDataSignatureCheck = Date.now();
			await this.updateDataFileStat();
			if (indexUpdated) {
				await this.ensureExcludedSync();
			}
			if (indexUpdated || settingsChanged) {
				this.refreshEpochViews();
			}
		}
	}
};
