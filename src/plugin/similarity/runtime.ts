import type { EpochPlugin } from "../../main";
import { embeddingsSimilarityEnabled } from "./config";
import { getSimilarityWorker } from "./worker-factory";

export function embeddingsComputeEnabled(plugin: EpochPlugin): boolean {
	if (!embeddingsSimilarityEnabled(plugin)) return false;
	if ((plugin as any).similarityWorkerDisabled) return false;
	const w = getSimilarityWorker(plugin);
	if (!w) return false;
	return true;
}
