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

export function computeTimelineSearchResultCountAllDates(
	canvas: EpochCanvas,
	qTrim: string,
	cache: TimelineSearchCountCache
): number | null {
	try {
		if (!canvas) return null;
		const canvasAny: any = canvas as any;
		const index: any = canvasAny?.index ?? null;
		if (!index || typeof index !== "object") return null;

		const parsed = parseTimelineQuery(qTrim);
		if (parsed?.invalid === true) return 0;

		const epochsViewActive = canvasAny?.epochsView === true;
		const currentEpochBucket: EpochBucket | null = (() => {
			if (!epochsViewActive) return null;
			try {
				const rawBucket = String(canvasAny?.epochsViewBucket ?? "");
				if (rawBucket && isEpochBucket(rawBucket)) return rawBucket;
			} catch {
				// ignore
			}
			try {
				const scale = Number(canvasAny?.scale ?? 1);
				let viewportHeight = 0;
				try {
					viewportHeight = Number(canvasAny?.root?.getBoundingClientRect?.()?.height ?? 0);
				} catch {
					viewportHeight = 0;
				}
				if (!(viewportHeight > 0)) {
					try {
						viewportHeight = Number(canvasAny?.canvas?.getBoundingClientRect?.()?.height ?? 0);
					} catch {
						viewportHeight = 0;
					}
				}
				if (!(viewportHeight > 0)) viewportHeight = 800;
				return pickEpochBucketForViewport(scale, viewportHeight) as any;
			} catch {
				return null;
			}
		})();

		const idxVersion = (() => {
			try {
				const n = Number(canvasAny?.__indexVersion ?? 0);
				return Number.isFinite(n) ? n : 0;
			} catch {
				return 0;
			}
		})();
		const filterKey = (() => {
			try {
				const showAttachments = canvasAny?.showAttachments ? 1 : 0;
				const showTrackedChanges = canvasAny?.showTrackedChanges ? 1 : 0;
				const showHidden = canvasAny?.showHidden ? 1 : 0;
				const hiddenOnly = /[!$]hidden\b/i.test(String(qTrim || "")) ? 1 : 0;
				const showDraftOnly = canvasAny?.showDraftOnly ? 1 : 0;
				const showContentDates = canvasAny?.showContentDates ? 1 : 0;
				const showPropDates = canvasAny?.showPropDates ? 1 : 0;
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
