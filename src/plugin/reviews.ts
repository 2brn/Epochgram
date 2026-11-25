import { Notice } from "obsidian";
import type { EpochPlugin } from "../main";
import type { DateEntry, ReviewState } from "../indexer/types";
import { Indexer } from "../indexer/indexer";
import { clearEpochProgress, consumeCancelRequested, setEpochProgress } from "./progress";

export interface ReviewMethods {
	setEntryReview(entry: DateEntry, state: ReviewState): Promise<void>;
	setPathsReview(paths: string[], state: ReviewState, preserveHidden?: boolean): Promise<void>;
	reviewAllDraftFiles(): Promise<void>;
}
export const reviewMethods: ReviewMethods = {
	async setEntryReview(this: EpochPlugin, entry, state) {
		await this.ensureIndexLoaded(); await this.waitForExcludedSync();
		while (this.indexLoadPromise) await this.ensureIndexLoaded();
		if (!this.indexer.setEntryReviewState(entry, state)) return;
		try { await this.persistIndex({ skipEnsure: true }); }
		finally { this.refreshEpochViews(); }
	},
	async setPathsReview(this: EpochPlugin, paths, state, preserveHidden = false) {
		await this.ensureIndexLoaded(); await this.waitForExcludedSync();
		while (this.indexLoadPromise) await this.ensureIndexLoaded();
		const previous = this.indexer.toJSON();
		// Stage review metadata privately: cancellation never rolls back concurrent file edits.
		const operation = Promise.resolve().then(async () => {
			const staged = new Indexer({ app: this.app, settings: this.settings });
			await staged.load(previous);
			let changed = false;
			try {
				const unique = [...new Set(paths)];
				for (let i = 0; i < unique.length; i++) {
					if (consumeCancelRequested(this, "review")) throw new Error("EPOCH_CANCELLED");
					changed = staged.setFileReviewState(unique[i], state, preserveHidden) || changed;
					if (unique.length > 50 && i % 50 === 0) {
						setEpochProgress(this, "review", `Review… ${i + 1}/${unique.length}`);
						await new Promise<void>(resolve => window.setTimeout(resolve, 0));
					}
				}
				if (consumeCancelRequested(this, "review")) throw new Error("EPOCH_CANCELLED");
			} catch (error) {
				if (error instanceof Error && error.message === "EPOCH_CANCELLED") { new Notice("Canceled"); return; }
				throw error;
			}
			clearEpochProgress(this, "review");
			if (changed && this.indexer.mergeReviewStates(staged.toJSON())) await this.persistIndex({ skipEnsure: true });
		});
		this.indexReady = false; this.indexLoadPromise = operation;
		try { await operation; }
		finally {
			this.indexReady = true;
			if (this.indexLoadPromise === operation) this.indexLoadPromise = null;
			consumeCancelRequested(this, "review"); clearEpochProgress(this, "review"); this.refreshEpochViews();
		}
	},
	async reviewAllDraftFiles(this: EpochPlugin) {
		await this.ensureIndexLoaded();
		await this.setPathsReview(this.indexer.getIndexedPaths(), "reviewed", true);
	}
};
