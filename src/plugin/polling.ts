import { readCurrentSettings } from "../settings-schema";
import type { PersistedPluginData } from "./state";
import type { EpochPlugin } from "../main";
import { computeTextHash } from "../utils";
import { scheduleTimelineSearchRebuild } from "./search-rebuild-scheduler";
import { bumpTimelineSearchIndexVersion } from "./timeline-search-cache";
import { mergeReviewStatesForSync } from "../indexer/review-state-sync";
interface PollOptions { forceIndex?: boolean; forceData?: boolean; }
export interface PollingMethods {
	pollExternalIndexChanges(options?: PollOptions): Promise<void>;
	reloadIndexFromDisk(): Promise<void>;
	reloadIndexFromPluginData(): Promise<void>;
}
export const pollingMethods: PollingMethods = {
	async pollExternalIndexChanges(this: EpochPlugin, options = {}) {
		if (this.indexPollInFlight || this.indexLoadPromise || !this.indexReady || (this as EpochPlugin & { __epochIndexWriteQueue?: Promise<void> }).__epochIndexWriteQueue) return;
		this.indexPollInFlight = true;
		try {
			this.refreshExcludedMatchers(); await this.waitForExcludedSync();
			const [indexStat, dataStat] = await Promise.all([this.statIndexFile(), this.statDataFile()]);
			let changed = options.forceIndex || this.didStatChange(this.indexFileStat, indexStat);
			const now = Date.now();
			if (!changed && now - this.lastIndexContentCheckAt > 60000) {
				this.lastIndexContentCheckAt = now;
				const runtime = this as EpochPlugin & { lastIndexDiskSignature?: string };
				const raw = await this.app.vault.adapter.exists(this.indexFilePath) ? await this.app.vault.adapter.read(this.indexFilePath) : "";
				let canonical = raw;
				try { canonical = JSON.stringify(JSON.parse(raw)); } catch { /* Malformed cache remains detectable. */ }
				const signature = computeTextHash(canonical);
				const baseline = runtime.lastIndexDiskSignature ?? computeTextHash(JSON.stringify(this.indexer.toJSON()));
				changed = baseline !== signature;
				if (!changed) runtime.lastIndexDiskSignature = signature;
			}
			if (changed) await this.reloadIndexFromDisk();
			if (options.forceData || changed || this.didStatChange(this.dataFileStat, dataStat) || now - this.lastDataSignatureCheck > 60000) await this.reloadIndexFromPluginData();
			if (!changed) this.indexFileStat = this.normalizeStat(indexStat);
		} finally { this.indexPollInFlight = false; }
	},
	async reloadIndexFromDisk(this: EpochPlugin) {
		const pending = (this as EpochPlugin & { __epochIndexWriteQueue?: Promise<void> }).__epochIndexWriteQueue;
		if (pending) await pending;
		const revision = this.indexer.revision;
		const disk = await this.loadIndexFromDisk();
		if (this.indexLoadPromise || this.indexer.revision !== revision) return;
		if (!disk) { await this.updateIndexFileStat(); return; }
		const reconciled = mergeReviewStatesForSync(disk, this.indexer.toJSON());
		await this.indexer.load(disk);
		(this as EpochPlugin & { lastIndexDiskSignature?: string }).lastIndexDiskSignature = computeTextHash(JSON.stringify(disk));
		if (reconciled) await this.saveCurrentIndexToDisk();
		// Preserve full-text documents while the updated vault is reconciled in the background.
		scheduleTimelineSearchRebuild(this); bumpTimelineSearchIndexVersion(this);
		this.scheduleInheritedMarkRecompute("index-disk-reload");
		this.indexReady = true; await this.updateIndexFileStat();
		this.refreshEpochViews(); void this.ensureExcludedSync();
	},
	async reloadIndexFromPluginData(this: EpochPlugin) {
		try {
			const saved = await this.loadData() as PersistedPluginData | null;
			const signature = this.computeDataSignature(saved);
			if (signature === this.lastDataSignature || !saved?.settings) return;
			this.lastDataSignature = signature;
			const settings = readCurrentSettings(saved.settings);
			if (!this.areSettingsEqual(this.settings, settings)) {
				this.settings = settings;
				this.viewPreferences = { showAttachments: settings.timelineFilters?.showAttachments === true, showParsed: settings.timelineFilters?.showParsed !== false, showDraftsOnly: this.viewPreferences.showDraftsOnly === true };
				this.refreshCalendarSyncSchedule(); this.scheduleInheritedMarkRecompute("settings"); this.refreshEpochViews();
			}
		} finally { this.lastDataSignatureCheck = Date.now(); await this.updateDataFileStat(); }
	}
};
