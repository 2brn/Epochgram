import { Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { hasAiBridgeAccess, isGenerateEpochsEffective } from "./pro-feature-state";
import { embeddingsSimilarityEnabled, isTopicSimilarityEnabled } from "./similarity/config";

export function computeRebuildGating(plugin: EpochPlugin): {
	semanticsEnabled: boolean;
	topicsEnabled: boolean;
	aiEnabled: boolean;
	epochsEnabled: boolean;
} {
	const vectorsEnabled = embeddingsSimilarityEnabled(plugin);
	const topicsEnabled = isTopicSimilarityEnabled(plugin);
	const aiEnabled = Platform.isDesktop && hasAiBridgeAccess(plugin);
	const epochsEnabled = isGenerateEpochsEffective(plugin);
	return { semanticsEnabled: vectorsEnabled, topicsEnabled, aiEnabled, epochsEnabled };
}
