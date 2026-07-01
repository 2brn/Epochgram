import type { EpochCanvas } from "../epoch-canvas";
import type { EpochBucket } from "../../indexer/types";

import { isEpochBucket } from "../../indexer/types";
import { dateKeyToDate } from "../epoch-canvas-focus";
import { pickEpochBucketForViewport } from "../epoch-canvas-constants";
import { getEntriesCountForDateFast } from "../entry-helpers";
import { parseTimelineQuery } from "../timeline-search";
import { getSimilarScopeSignature } from "../entry-helpers/shared";

export type TimelineSearchCountCache = {
	key: string | null;
	value: number | null;
};

type SearchCountCanvasLike = {
	index?: Record<string, unknown>;
	epochsView?: boolean;
	epochsViewBucket?: unknown;
	scale?: number;
	root?: { getBoundingClientRect?: () => { height?: number } };
	canvas?: { getBoundingClientRect?: () => { height?: number } };
	__indexVersion?: number;
	showAttachments?: boolean;
	showTrackedChanges?: boolean;
	showHidden?: boolean;
	showDraftOnly?: boolean;
	showContentDates?: boolean;
	showPropDates?: boolean;
};

export function computeTimelineSearchResultCountAllDates(
	canvas: EpochCanvas,
	qTrim: string,
	cache: TimelineSearchCountCache
): number | null {
	try {
		if (!canvas) return null;
		const canvasState = canvas as unknown as SearchCountCanvasLike;
		const index = canvasState.index ?? null;
		if (!index || typeof index !== "object") return null;

		const parsed = parseTimelineQuery(qTrim);
		if (parsed?.invalid === true) return 0;

		const epochsViewActive = canvasState.epochsView === true;
		const currentEpochBucket: EpochBucket | null = (() => {
			if (!epochsViewActive) return null;
			try {
				const rawBucket = typeof canvasState.epochsViewBucket === "string" ? canvasState.epochsViewBucket : "";
				if (rawBucket && isEpochBucket(rawBucket)) return rawBucket;
			} catch {
				// ignore
			}
			try {
				const scale = Number(canvasState.scale ?? 1);
				let viewportHeight = 0;
				try {
					viewportHeight = Number(canvasState.root?.getBoundingClientRect?.()?.height ?? 0);
				} catch {
					viewportHeight = 0;
				}
				if (!(viewportHeight > 0)) {
					try {
						viewportHeight = Number(canvasState.canvas?.getBoundingClientRect?.()?.height ?? 0);
					} catch {
						viewportHeight = 0;
					}
				}
				if (!(viewportHeight > 0)) viewportHeight = 800;
				return pickEpochBucketForViewport(scale, viewportHeight);
			} catch {
				return null;
			}
		})();

		const idxVersion = (() => {
			try {
				const n = Number(canvasState.__indexVersion ?? 0);
				return Number.isFinite(n) ? n : 0;
			} catch {
				return 0;
			}
		})();
		const filterKey = (() => {
			try {
				const showAttachments = canvasState.showAttachments ? 1 : 0;
				const showTrackedChanges = canvasState.showTrackedChanges ? 1 : 0;
				const showHidden = canvasState.showHidden ? 1 : 0;
				const hiddenOnly = /[!$]hidden\b/i.test(String(qTrim || "")) ? 1 : 0;
				const showDraftOnly = canvasState.showDraftOnly ? 1 : 0;
				const showContentDates = canvasState.showContentDates ? 1 : 0;
				const showPropDates = canvasState.showPropDates ? 1 : 0;
				return `${showAttachments}${showTrackedChanges}${showHidden}${hiddenOnly}${showDraftOnly}${showContentDates}${showPropDates}`;
			} catch {
				return "";
			}
		})();
		const similarScopeSig = getSimilarScopeSignature(canvas, parsed);

		const key = `${qTrim}|${idxVersion}|${epochsViewActive ? 1 : 0}|${String(currentEpochBucket || "")}|${filterKey}|${similarScopeSig}`;
		if (cache.key === key && typeof cache.value === "number") {
			return cache.value;
		}

		const range = parsed?.dateRange ?? null;
		let total = 0;
		for (const dateKey of Object.keys(index)) {
			if (range && (dateKey < range.start || dateKey > range.end)) continue;
			const dt = dateKeyToDate(dateKey);
			if (!dt) continue;
			const n = getEntriesCountForDateFast(canvas, dt, epochsViewActive && currentEpochBucket ? { epochBucket: currentEpochBucket } : {});
			if (n > 0) total += n;
		}
		cache.key = key;
		cache.value = total;
		return total;
	} catch {
		return null;
	}
}
