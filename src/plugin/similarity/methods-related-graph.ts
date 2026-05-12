import { TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import {
	TITLE_SIMILARITY_MAX_LEN_DIFF,
} from "./config";
import { getDirectLinkedPaths, getSameTagPaths } from "./graph";
import { getNoteTitleFromPath, jaroWinkler, normalizeTitleForSimilarity } from "../../utils";
import {
	canMatchBySignalMask,
	getFileSimilaritySignalMask,
	SIGNAL_LINKS,
	SIGNAL_TAGS,
	SIGNAL_TITLE
} from "./file-similarity-signals";
import {
	getEffectiveSimilarityUseLinks,
	getEffectiveSimilarityUseTags,
	getEffectiveTitleSimilarityThreshold
} from "../pro-feature-state";

export const methodsRelatedGraph: Pick<SimilarityMethods, "getGraphRelatedPathsForFile"> = {
	async getGraphRelatedPathsForFile(this: EpochPlugin, filePath: string): Promise<Set<string>> {
		const out = new Set<string>();
		try {
			if (!filePath) return out;
			out.add(filePath);

			const maskByPath = new Map<string, number>();
			const mask = (p: string): number => {
				const prev = maskByPath.get(p);
				if (typeof prev === "number") return prev;
				const m = getFileSimilaritySignalMask(this as any, p);
				maskByPath.set(p, m);
				return m;
			};
			const centerMask = mask(filePath);

			const forced = new Set<string>();
			try {
				const useLinks = getEffectiveSimilarityUseLinks(this);
				const useTags = getEffectiveSimilarityUseTags(this);
				if (useLinks && centerMask !== 0) {
					for (const p of getDirectLinkedPaths(this, filePath)) {
						if (!canMatchBySignalMask(centerMask, mask(p), SIGNAL_LINKS)) continue;
						forced.add(p);
					}
				}
				if (useTags && centerMask !== 0) {
					for (const p of getSameTagPaths(this, filePath)) {
						if (!canMatchBySignalMask(centerMask, mask(p), SIGNAL_TAGS)) continue;
						forced.add(p);
					}
				}
			} catch {
				// ignore
			}

			for (const p of forced) {
				const af = this.app.vault.getAbstractFileByPath(p);
				if (!(af instanceof TFile)) continue;
				if (!this.shouldIndexFile(af)) continue;
				out.add(p);
			}

			const titleThr = getEffectiveTitleSimilarityThreshold(this);
			const titleMaxLenDiff = TITLE_SIMILARITY_MAX_LEN_DIFF;

			const centerTitle = titleThr > 0 && centerMask !== 0 ? normalizeTitleForSimilarity(getNoteTitleFromPath(filePath)) : "";
			if (centerTitle) {
				const files = this.app.vault.getFiles();
				for (const f of files) {
					if (!f || f.path === filePath) continue;
					if (!this.shouldIndexFile(f)) continue;
					if (out.has(f.path)) continue;
					if (!canMatchBySignalMask(centerMask, mask(f.path), SIGNAL_TITLE)) continue;
					const otherTitle = normalizeTitleForSimilarity(getNoteTitleFromPath(f.path));
					if (!otherTitle) continue;
					if (titleMaxLenDiff >= 0) {
						const diff = Math.abs(centerTitle.length - otherTitle.length);
						if (diff > titleMaxLenDiff) continue;
					}
					const score = jaroWinkler(centerTitle, otherTitle);
					if (score >= titleThr) {
						out.add(f.path);
					}
				}
			}
		} catch {
			// ignore
		}
		return out;
	}
};
