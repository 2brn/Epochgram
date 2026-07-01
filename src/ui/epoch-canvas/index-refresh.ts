import type { EpochCanvas } from "../epoch-canvas";
import type { EpochIndex } from "../../indexer/types";

import { resetScrollNavTargetState } from "./scroll-nav-reset";

import {
	updatePathsWithEmbeddingTerm,
	updatePathsWithClassifiedTerm,
	updateSemanticRelatedTermPaths
} from "./semantic";

type CanvasRefreshState = {
	plugin?: {
		indexer?: {
			index?: EpochIndex;
		};
	};
	index?: EpochIndex;
	__indexVersion?: number;
	__scrollNavVisibleTargetsSig?: string | null;
	__scrollNavVisibleTargets?: unknown;
	semanticRelatedTermLastUpdatedAt?: number | null;
	scrollNavFile?: string | null;
	__scrollNavLastModeKey?: string | null;
	draw?: () => void;
};

export function refreshIndex(canvas: EpochCanvas): void {
	const c = canvas as unknown as CanvasRefreshState;
	const index = c?.plugin?.indexer?.index;
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
		c.__scrollNavLastModeKey = null;
	} catch {
		// ignore
	}
	c.draw?.();
}
