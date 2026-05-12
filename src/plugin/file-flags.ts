import { TFile } from "obsidian";
import type { EpochPlugin } from "../main";
import { getUsedMarkColorIndexSet, pickDefaultMarkColorIndex } from "../ui/mark-colors";
import { embeddingsSimilarityEnabled } from "./similarity/config";

export interface FileFlagMethods {
	setFileMarkColor(file: TFile, markColor: number | null): Promise<void>;
	cycleFileMarkColor(file: TFile): Promise<void>;
	toggleFilePin(file: TFile, pinned: boolean): Promise<void>;
}

export const fileFlagMethods: FileFlagMethods = {
	async setFileMarkColor(this: EpochPlugin, file: TFile, markColor: number | null): Promise<void> {
		await this.ensureIndexLoaded();
		await this.waitForExcludedSync();
		if (!this.shouldIndexFile(file)) return;
		const changed = this.indexer.setFileMarkColor(file.path, markColor);
		if (!changed) return;
		try {
			(this as any).scheduleInheritedMarkRecompute?.("mark-change");
		} catch {
			// ignore
		}
		// If we just marked a file and similarity is enabled, prioritize building its vector.
		try {
			if (markColor != null && this.hasProAccess?.() && embeddingsSimilarityEnabled(this)) {
				(this as any).queueVectorUpdate?.(file.path);
			}
		} catch {
			// ignore
		}
		await this.persist({ skipEnsure: true });
		this.refreshEpochViews();
	},

	async cycleFileMarkColor(this: EpochPlugin, file: TFile): Promise<void> {
		await this.ensureIndexLoaded();
		await this.waitForExcludedSync();
		if (!this.shouldIndexFile(file)) return;
		const current: number | null = this.indexer.getFileMarkColor(file.path);
		const filesObj: any = this.indexer.toJSON().files;
		const desired = current != null ? null : pickDefaultMarkColorIndex(getUsedMarkColorIndexSet(filesObj, file.path), current);
		const changed = this.indexer.setFileMarkColor(file.path, desired);
		if (!changed) return;
		try {
			(this as any).scheduleInheritedMarkRecompute?.("mark-change");
		} catch {
			// ignore
		}
		await this.persist({ skipEnsure: true });
		this.refreshEpochViews();
	},

	async toggleFilePin(this: EpochPlugin, file: TFile, pinned: boolean): Promise<void> {
		await this.ensureIndexLoaded();
		await this.waitForExcludedSync();
		if (!this.shouldIndexFile(file)) return;
		const changed = this.indexer.setFilePinned(file.path, pinned);
		if (!changed) return;
		await this.persist({ skipEnsure: true });
		this.refreshEpochViews();
	}
};
