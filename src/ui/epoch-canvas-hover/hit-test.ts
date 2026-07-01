import type { DateEntry } from "../../indexer/types";
import type { DayLayout } from "../epoch-canvas-types";
import type { EpochCanvas } from "../epoch-canvas";
import { normalizeMarkColorIndex } from "../mark-colors";
import { hoverState } from "./internals";

type HoverCanvasState = {
	inheritedMarkSourceByPath?: Map<string, string> | null;
};

export function findSummaryEntryAtPoint(canvas: EpochCanvas, x: number, y: number): DateEntry | null {
	const state = hoverState(canvas);
	for (const layout of state.layouts) {
		let bestEntry: DateEntry | null = null;
		let bestDist = Number.POSITIVE_INFINITY;
		let bestPriority = -1;
		const hitRects = new Map<number, { entry: DateEntry; x1: number; y1: number; x2: number; y2: number }>();
		const stableRects = layout.summaryHoverRects ?? layout.summaryRects;

		for (const rect of stableRects ?? []) {
			hitRects.set(rect.itemIndex, {
				entry: rect.entry,
				x1: rect.x1,
				y1: rect.y1,
				x2: rect.x2,
				y2: rect.y2,
			});
		}

		for (const rect of layout.summaryRects ?? []) {
			const prev = hitRects.get(rect.itemIndex);
			if (!prev) {
				hitRects.set(rect.itemIndex, {
					entry: rect.entry,
					x1: rect.x1,
					y1: rect.y1,
					x2: rect.x2,
					y2: rect.y2,
				});
				continue;
			}
			prev.x1 = Math.min(prev.x1, rect.x1);
			prev.y1 = Math.min(prev.y1, rect.y1);
			prev.x2 = Math.max(prev.x2, rect.x2);
			prev.y2 = Math.max(prev.y2, rect.y2);
		}

		const inheritedSourceMap: Map<string, string> | null = (() => {
			try {
				const map = (canvas as unknown as HoverCanvasState).inheritedMarkSourceByPath;
				return map && typeof map.get === "function" ? map : null;
			} catch {
				return null;
			}
		})();

		for (const rect of hitRects.values()) {
			if (!(x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2)) continue;
			const entry = rect.entry;
			const filePath = entry.file;
			const isMarked = !!normalizeMarkColorIndex(entry.markColor);
			const hasInherited = !!(inheritedSourceMap && typeof filePath === "string" && filePath && inheritedSourceMap.get(filePath));
			const isActive = !!(state.activeFilePath && typeof filePath === "string" && filePath === state.activeFilePath);
			const centerY = (rect.y1 + rect.y2) / 2;
			const dist = Math.abs(centerY - y);
			const priority = isActive && (isMarked || hasInherited) ? 3 : hasInherited ? 2 : isMarked ? 1 : 0;

			if (
				bestEntry == null ||
				dist < bestDist ||
				(dist === bestDist && priority > bestPriority)
			) {
				bestEntry = entry;
				bestDist = dist;
				bestPriority = priority;
			}
		}
		if (bestEntry) return bestEntry;
	}
	return null;
}

export function findDayLayoutAtPoint(canvas: EpochCanvas, x: number, y: number): DayLayout | null {
	const state = hoverState(canvas);
	for (const layout of state.layouts) {
		if (!layout.hasVisibleDate) continue;
		const rect = layout.dateRect;
		if (x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2) {
			return layout;
		}
	}
	return null;
}
