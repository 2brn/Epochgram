import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import { readStore, writeStore } from "./store";
import { scheduleProcessPendingQueue } from "./vectors-queue";
import { embeddingsSimilarityEnabled } from "./config";
import { isLikelyTextFilePath } from "../../utils";

export const methodsVectors: Pick<
	SimilarityMethods,
	| "queueVectorUpdate"
	| "removeVector"
	| "renameVector"
	| "reloadVectorsFromDisk"
	| "ensureSimilarityStoreLoaded"
> = {
	queueVectorUpdate(this: EpochPlugin, filePath: string): void {
		if (!embeddingsSimilarityEnabled(this)) return;
		const p = String(filePath || "").trim();
		if (!p) return;
		if (p.startsWith("epoch://")) return;
		if (!isLikelyTextFilePath(p)) return;
		const pending: Set<string> =
			this.similarityPendingFiles instanceof Set
				? this.similarityPendingFiles
				: (this.similarityPendingFiles = new Set<string>());
		pending.add(p);
		scheduleProcessPendingQueue(this, 50);
	},

	async removeVector(this: EpochPlugin, filePath: string): Promise<void> {
		const store = await readStore(this);
		if (store.files[filePath]) {
			delete store.files[filePath];
			await writeStore(this, store);
		}
	},

	async renameVector(this: EpochPlugin, oldPath: string, newPath: string): Promise<void> {
		const store = await readStore(this);
		const existing = store.files[oldPath];
		if (!existing) return;
		delete store.files[oldPath];
		store.files[newPath] = existing;
		await writeStore(this, store);
	},

	async reloadVectorsFromDisk(this: EpochPlugin): Promise<void> {
		try {
			this.similarityVectorsLoaded = false;
			this.similarityIndex = null;
			try {
				await this.updateVectorsFileStat?.();
			} catch {
				// ignore
			}
			try {
				this.scheduleInheritedMarkRecompute?.("vectors-sync");
			} catch {
				// ignore
			}
			this.refreshEpochViews();
		} catch {
			// ignore
		}
	},

	async ensureSimilarityStoreLoaded(this: EpochPlugin): Promise<void> {
		try {
			await readStore(this);
		} catch {
			// ignore
		}
	}
};
