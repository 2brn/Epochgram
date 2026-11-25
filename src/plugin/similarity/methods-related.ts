import { TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import { TITLE_SIMILARITY_MAX_LEN_DIFF, getEffectiveSimilarityUseLinks, getEffectiveSimilarityUseTags, getEffectiveTitleSimilarityThreshold } from "./config";
import { getDirectLinkedPaths, getSameTagPaths } from "./graph";
import { getFolderPathFromFilePath, getNoteTitleFromPath, jaroWinkler, normalizeTitleForSimilarity } from "../../utils";
import { canMatchBySignalMask, getFileSimilaritySignalMask, SIGNAL_LINKS, SIGNAL_TAGS, SIGNAL_TITLE } from "./file-similarity-signals";

export const methodsRelated: Pick<SimilarityMethods, "getRelatedPathsForFile" | "getRelatedScoredForFile"> = {
	async getRelatedPathsForFile(this: EpochPlugin, path: string): Promise<Set<string>> {
		return new Set((await methodsRelated.getRelatedScoredForFile.call(this, path)).map(item => item.path));
	},
	async getRelatedScoredForFile(this: EpochPlugin, path: string): Promise<Array<{ path: string; score: number }>> {
		if (!path) return [];
		const centerMask = getFileSimilaritySignalMask(this, path);
		if (!centerMask) return [];
		const allows = (other: string, signal: number) => canMatchBySignalMask(centerMask, getFileSimilaritySignalMask(this, other), signal);
		const scores = new Map<string, number>();
		const add = (other: string, score: number, signal: number) => {
			if (other === path || !allows(other, signal)) return;
			const file = this.app.vault.getAbstractFileByPath(other);
			if (file instanceof TFile && this.shouldIndexFile(file)) scores.set(other, Math.max(scores.get(other) ?? 0, score));
		};
		if (getEffectiveSimilarityUseLinks(this)) for (const other of getDirectLinkedPaths(this, path)) add(other, 1, SIGNAL_LINKS);
		if (getEffectiveSimilarityUseTags(this)) for (const other of getSameTagPaths(this, path)) add(other, 1, SIGNAL_TAGS);
		const threshold = getEffectiveTitleSimilarityThreshold(this);
		if (threshold > 0 && (centerMask & SIGNAL_TITLE) !== 0) {
			const title = normalizeTitleForSimilarity(getNoteTitleFromPath(path));
			const folder = getFolderPathFromFilePath(path);
			for (const file of this.app.vault.getFiles()) {
				if (threshold === 1) {
					if (getFolderPathFromFilePath(file.path) === folder) add(file.path, 1, SIGNAL_TITLE);
					continue;
				}
				const otherTitle = normalizeTitleForSimilarity(getNoteTitleFromPath(file.path));
				if (!title || !otherTitle || Math.abs(title.length - otherTitle.length) > TITLE_SIMILARITY_MAX_LEN_DIFF) continue;
				const score = jaroWinkler(title, otherTitle);
				if (score >= threshold) add(file.path, score, SIGNAL_TITLE);
			}
		}
		return Array.from(scores, ([path, score]) => ({ path, score })).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	}
};
