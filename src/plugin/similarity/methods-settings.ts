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

type SimilaritySettingsPluginState = {
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	scheduleMissingTopicClassificationSweep?: (reason: string) => void;
	similarityPendingFiles?: Set<string>;
	similarityQueueTotal?: number;
	similarityQueueProcessed?: number;
	similarityLastZeroShotMinScore?: number;
	similarityLastVectorsEnabled?: boolean;
	similarityVectorQueueStartedAt?: number;
	queueVectorUpdate?: (path: string) => void;
};

export const methodsSettings: Pick<SimilarityMethods, "onSimilaritySettingsChanged"> = {
	async onSimilaritySettingsChanged(
		this: EpochPlugin,
		key: "similarityThreshold" | "similarityZeroShotMinScore"
	): Promise<void> {
		if (!hasSimilarityAccess(this)) return;
		const state = this as EpochPlugin & SimilaritySettingsPluginState;

		const clearPendingTopicClassificationQueue = (): void => {
			try {
				state.termSimilarityPendingFiles = new Set<string>();
				state.termSimilarityQueueTotal = 0;
				state.termSimilarityQueueProcessed = 0;
			} catch {
				// ignore
			}
		};

		const scheduleMissingTopicClassificationSweep = (reason: string): void => {
			try {
				state.scheduleMissingTopicClassificationSweep?.(reason);
			} catch {
				// ignore
			}
		};

		if (!hasSimilarityAccess(this)) {
			try {
				state.similarityPendingFiles = new Set<string>();
				state.similarityQueueTotal = 0;
				state.similarityQueueProcessed = 0;
			} catch {
				// ignore
			}
			clearPendingTopicClassificationQueue();
			return;
		}

		if (key === "similarityZeroShotMinScore") {
			const clampedNow = getEffectiveZeroShotMinScore(this);
			const prev =
				typeof state.similarityLastZeroShotMinScore === "number"
					? state.similarityLastZeroShotMinScore
					: clampedNow;
			state.similarityLastZeroShotMinScore = clampedNow;

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
			typeof state.similarityLastVectorsEnabled === "boolean"
				? state.similarityLastVectorsEnabled
				: false;
		const vectorsEnabledNow = embeddingsSimilarityEnabled(this);
		state.similarityLastVectorsEnabled = vectorsEnabledNow;
		if (!vectorsEnabledNow) {
			try {
				state.similarityPendingFiles = new Set<string>();
				state.similarityQueueTotal = 0;
				state.similarityQueueProcessed = 0;
			} catch {
				// ignore
			}
			return;
		}

		const modelId = getSimilarityModelId(this);
		if (prevVectorsEnabled) return;

		void loadEmbeddingsModelViaWorker(this, modelId);
		try {
			state.similarityVectorQueueStartedAt = now();
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
					if (!isLikelyTextFileExtension(String(f.extension ?? ""))) continue;
					const existing = store.files[f.path];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (hasHash && hasVector) continue;
					state.queueVectorUpdate?.(f.path);
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
