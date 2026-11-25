import type { EpochPlugin } from "../main";
import { computeInheritedMarkData, type PrecomputedGraphCandidates } from "../ui/inherited-mark";
import { getDirectLinkedPaths, getSameTagPaths } from "./similarity/graph";
import { getEffectiveSimilarityUseLinks, getEffectiveSimilarityUseTags, getEffectiveTitleSimilarityThreshold } from "./similarity/config";
import { canMatchBySignalMask, getFileSimilaritySignalMask, SIGNAL_LINKS, SIGNAL_TAGS, SIGNAL_TITLE } from "./similarity/file-similarity-signals";
export interface InheritedMarkMethods {
	scheduleInheritedMarkRecompute(reason?: string): void;
	recomputeInheritedMarksNow(reason?: string): Promise<void>;
	clearInheritedMarksCache(): void;
}
export const inheritedMarkMethods: InheritedMarkMethods = {
	scheduleInheritedMarkRecompute(this: EpochPlugin, reason) {
		if (this.__epochInheritedMarkRecomputeTimer != null) return;
		this.__epochInheritedMarkRecomputeTimer = window.setTimeout(() => {
			this.__epochInheritedMarkRecomputeTimer = null;
			void this.recomputeInheritedMarksNow(reason);
		}, 250);
	},
	async recomputeInheritedMarksNow(this: EpochPlugin, _reason) {
		try {
		const paths = this.indexer.getIndexedPaths();
		const seeds = paths.filter(path => this.indexer.getFileMarkColor(path) != null);
		const links: PrecomputedGraphCandidates = new Map();
		const tags: PrecomputedGraphCandidates = new Map();
		for (const seed of seeds) {
			if (getEffectiveSimilarityUseLinks(this)) links.set(seed, Array.from(getDirectLinkedPaths(this, seed), path => ({ path })));
			if (getEffectiveSimilarityUseTags(this)) tags.set(seed, Array.from(getSameTagPaths(this, seed), path => ({ path })));
		}
		const masks = new Map(paths.map(path => [path, getFileSimilaritySignalMask(this, path)]));
		const data = computeInheritedMarkData({
			visiblePaths: paths, seedPaths: seeds, linkCandidatesBySeedPath: links, tagCandidatesBySeedPath: tags,
			getFileMarkColor: path => this.indexer.getFileMarkColor(path), getFileMarkHex: path => this.indexer.getFileMarkHex(path),
			titleJwThreshold: getEffectiveTitleSimilarityThreshold(this),
			canMatch: (seed, candidate, reason) => canMatchBySignalMask(masks.get(seed) ?? 0, masks.get(candidate) ?? 0, reason === "link" ? SIGNAL_LINKS : reason === "tag" ? SIGNAL_TAGS : SIGNAL_TITLE)
		});
		this.__epochInheritedMarkIndexByPath = data?.indexByPath ?? new Map();
		this.__epochInheritedMarkSourceByPath = data?.sourceByPath ?? new Map();
		this.__epochInheritedMarkReasonByPath = data?.reasonByPath ?? new Map();
		this.__epochInheritedMarkComputedAt = Math.max(Date.now(), (this.__epochInheritedMarkComputedAt ?? 0) + 1);
		} catch {
			this.clearInheritedMarksCache();
		}
		this.refreshEpochViews();
	},
	clearInheritedMarksCache(this: EpochPlugin) {
		if (this.__epochInheritedMarkRecomputeTimer != null) window.clearTimeout(this.__epochInheritedMarkRecomputeTimer);
		this.__epochInheritedMarkRecomputeTimer = null;
		this.__epochInheritedMarkIndexByPath = new Map();
		this.__epochInheritedMarkSourceByPath = new Map();
		this.__epochInheritedMarkReasonByPath = new Map();
		this.__epochInheritedMarkComputedAt = Math.max(Date.now(), (this.__epochInheritedMarkComputedAt ?? 0) + 1);
	}
};
