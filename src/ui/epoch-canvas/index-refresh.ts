import type { EpochCanvas } from "../epoch-canvas";
import type { EpochIndex } from "../../indexer/types";

import { resetScrollNavTargetState } from "./scroll-nav-reset";

import {
	updatePathsWithEmbeddingTerm,
	updatePathsWithClassifiedTerm,
	updateSemanticRelatedTermPaths
} from "./semantic";

export function refreshIndex(canvas: EpochCanvas): void {
	const c: any = canvas as any;
	const index = c?.plugin?.indexer?.index as EpochIndex | undefined;
	c.index = index ? { ...index } : {};
	try {
		c.__indexVersion = (Number(c.__indexVersion) || 0) + 1;
		c.__scrollNavVisibleTargetsSig = null;
		c.__scrollNavVisibleTargets = null;
	} catch {
		// ignore
	}
	updatePathsWithEmbeddingTerm(canvas);
	updatePathsWithClassifiedTerm(canvas);
	c.semanticRelatedTermLastUpdatedAt = null;
	updateSemanticRelatedTermPaths(canvas);
	// Index refresh (including rebuild/reprocess) should reset scroll-nav state.
	resetScrollNavTargetState(canvas);
	c.scrollNavFile = null;
	try {
		(c as any).__scrollNavLastModeKey = null;
	} catch {
		// ignore
	}
	c.draw();
}
