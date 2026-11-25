import type { EpochCanvas } from "../epoch-canvas";
import type { EpochPlugin } from "../../main";
import { getEffectiveTitleSimilarityThreshold } from "../../plugin/similarity/config";
type State = {
	plugin: EpochPlugin; activeFilePath: string | null; relatedBasePath?: string | null;
	relatedPaths: Set<string> | null; relatedScored: Array<{ path: string; score: number }> | null;
	relatedRequestId: number; __relatedSignature?: string; __indexVersion?: number; draw(): void;
};
export function refreshRelatedForActiveFile(canvas: EpochCanvas, force = false): void {
	const c = canvas as unknown as State;
	const path = c.activeFilePath;
	const signature = [path, c.__indexVersion, c.plugin.settings.similarityUseLinks !== false, c.plugin.settings.similarityUseTags !== false, getEffectiveTitleSimilarityThreshold(c.plugin)].join("|");
	if (!force && signature === c.__relatedSignature) return;
	c.__relatedSignature = signature; c.relatedBasePath = path;
	c.relatedPaths = null; c.relatedScored = null;
	const request = ++c.relatedRequestId;
	if (path) void c.plugin.getRelatedScoredForFile(path).then(scored => {
		if (c.relatedRequestId !== request || c.activeFilePath !== path) return;
		c.relatedScored = scored; c.relatedPaths = new Set(scored.map(item => item.path)); c.draw();
	}).catch(error => console.error("Epochgram: Related records failed", error));
	c.draw();
}
