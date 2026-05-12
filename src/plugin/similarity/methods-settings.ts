import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import {
	embeddingsSimilarityEnabled,
	getSimilarityModelId,
	isTopicSimilarityEnabled
} from "./config";
import { embeddingsComputeEnabled } from "./runtime";
import { readStore } from "./store";
import { loadEmbeddingsModelViaWorker } from "./worker-embed";
import { now, sleep } from "./time";
import { isLikelyTextFileExtension } from "../../utils";
import { sortFilesNewestRecordFirst } from "./files";
import { getEffectiveZeroShotMinScore, hasSimilarityAccess } from "../pro-feature-state";

export const methodsSettings: Pick<SimilarityMethods, "onSimilaritySettingsChanged"> = {
	async onSimilaritySettingsChanged(
		this: EpochPlugin,
		key: "similarityThreshold" | "similarityZeroShotMinScore"
	): Promise<void> {
		if (!hasSimilarityAccess(this)) return;
		const anyPlugin: any = this as any;

		const clearPendingTopicClassificationQueue = (): void => {
			try {
				anyPlugin.termSimilarityPendingFiles = new Set<string>();
				anyPlugin.termSimilarityQueueTotal = 0;
				anyPlugin.termSimilarityQueueProcessed = 0;
			} catch {
				// ignore
			}
		};

		const scheduleMissingTopicClassificationSweep = (reason: string): void => {
			try {
				(this as any)?.scheduleMissingTopicClassificationSweep?.(reason);
			} catch {
				// ignore
			}
		};

		if (!hasSimilarityAccess(this)) {
			try {
				anyPlugin.similarityPendingFiles = new Set<string>();
				anyPlugin.similarityQueueTotal = 0;
				anyPlugin.similarityQueueProcessed = 0;
			} catch {
				// ignore
			}
			clearPendingTopicClassificationQueue();
			return;
		}

		if (key === "similarityZeroShotMinScore") {
			const clampedNow = getEffectiveZeroShotMinScore(this);
			const prev =
				typeof anyPlugin.similarityLastZeroShotMinScore === "number"
					? anyPlugin.similarityLastZeroShotMinScore
					: clampedNow;
			anyPlugin.similarityLastZeroShotMinScore = clampedNow;

			if (prev !== clampedNow) {
				if (!isTopicSimilarityEnabled(this)) {
					clearPendingTopicClassificationQueue();
					this.refreshEpochViews();
				} else {
					scheduleMissingTopicClassificationSweep("similarityZeroShotMinScore");
				}
			}
		}

		const prevVectorsEnabled =
			typeof anyPlugin.similarityLastVectorsEnabled === "boolean"
				? anyPlugin.similarityLastVectorsEnabled
				: false;
		const vectorsEnabledNow = embeddingsSimilarityEnabled(this);
		anyPlugin.similarityLastVectorsEnabled = vectorsEnabledNow;
		if (!vectorsEnabledNow) {
			try {
				anyPlugin.similarityPendingFiles = new Set<string>();
				anyPlugin.similarityQueueTotal = 0;
				anyPlugin.similarityQueueProcessed = 0;
			} catch {
				// ignore
			}
			return;
		}

		const modelId = getSimilarityModelId(this);
		if (prevVectorsEnabled) return;

		void loadEmbeddingsModelViaWorker(this, modelId);
		try {
			(anyPlugin as any).similarityVectorQueueStartedAt = now();
		} catch {
			// ignore
		}
		void (async () => {
			try {
				const store = await readStore(this);
				const files = sortFilesNewestRecordFirst(this, this.app.vault.getFiles());
				let enq = 0;
				for (const f of files) {
					if (!embeddingsComputeEnabled(this)) break;
					if (!this.shouldIndexFile(f)) continue;
					if (!isLikelyTextFileExtension(String((f as any)?.extension ?? ""))) continue;
					const existing: any = (store.files as any)?.[f.path];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (hasHash && hasVector) continue;
					(this as any).queueVectorUpdate?.(f.path);
					enq++;
					if (enq % 50 === 0) {
						await sleep(0);
					}
				}
			} catch {
				// ignore
			}
		})();
	}
};
