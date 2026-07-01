import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import { focusDate as focusDateHelper, getDayIndexForDate as getDayIndexForDateHelper } from "../epoch-canvas-focus";
import { BASE_SPACING } from "../epoch-canvas-constants";

type PendingHighlightLike = { dayIndex?: number; date?: Date } | null;

type ScrollNavAdvanceState = {
	scrollNavIndex: number;
	pendingScrollNavHighlight: PendingHighlightLike;
	hoverDateIndex?: number | null;
	animDateIndex?: number | null;
	scrollNavAnchorDayIndex?: number | null;
	__scrollNavAnchorMode?: string | null;
	offsetY: number;
	scale: number;
	hoverSummary?: unknown;
	animSummary?: unknown;
	hoverTarget?: number;
	scrollNavAnchorEntry?: unknown;
	animatingView?: boolean;
};

export function advanceScrollNavSimilar(params: {
	canvas: EpochCanvas;
	c: ScrollNavAdvanceState;
	direction: number;
	wrap: boolean;
	prevPending: PendingHighlightLike;
	rect: DOMRect;
	targets: Array<Extract<ScrollNavTarget, { kind: "entry" }>>;
}): boolean {
	const { canvas, c, direction, wrap, prevPending, rect, targets } = params;

	const dayTargets: Array<{ dayIndex: number; date: Date }> = (() => {
		const out: Array<{ dayIndex: number; date: Date }> = [];
		const seen = new Set<number>();
		for (const t of targets) {
			const di0 = getDayIndexForDateHelper(canvas, t.date);
			if (!Number.isFinite(di0)) continue;
			const di = Number(di0);
			if (seen.has(di)) continue;
			seen.add(di);
			out.push({ dayIndex: di, date: t.date });
		}
		out.sort((a, b) => a.dayIndex - b.dayIndex);
		return out;
	})();
	if (dayTargets.length === 0) {
		c.scrollNavIndex = -1;
		c.pendingScrollNavHighlight = null;
		return false;
	}

	let anchorDayIndex: number | null = null;
	let anchorFromFocus = false;
	// If a previous scroll-nav highlight is still in-flight, anchor from that intended day.
	if (prevPending && typeof prevPending.dayIndex === "number" && Number.isFinite(prevPending.dayIndex)) {
		anchorDayIndex = prevPending.dayIndex;
		anchorFromFocus = true;
		const idx = dayTargets.findIndex((d) => d.dayIndex === anchorDayIndex);
		if (idx >= 0) {
			c.scrollNavIndex = idx;
		}
	}
	// Similar navigation targets dates: anchor only from date hover (not summary hover).
	if (anchorDayIndex == null) {
		const dateFocus = c.hoverDateIndex ?? c.animDateIndex;
		if (dateFocus != null) {
			anchorDayIndex = dateFocus;
			anchorFromFocus = true;
		}
	}
	// Preserve explicit anchoring (e.g. startup/click) via the day index.
	if (anchorDayIndex == null) {
		const anchoredDay: number | null =
			typeof c.scrollNavAnchorDayIndex === "number" && Number.isFinite(c.scrollNavAnchorDayIndex)
				? c.scrollNavAnchorDayIndex
				: null;
		if (anchoredDay != null) {
			anchorDayIndex = anchoredDay;
			anchorFromFocus = true;
		}
	}
	if (
		anchorDayIndex == null &&
		c.scrollNavIndex >= 0 &&
		c.scrollNavIndex < dayTargets.length
	) {
		anchorDayIndex = dayTargets[c.scrollNavIndex].dayIndex;
		anchorFromFocus = true;
	}
	if (anchorDayIndex == null) {
		let anchorScreenY = direction >= 0 ? 0 : rect.height;
		try {
			if (String(c.__scrollNavAnchorMode || "") === "center") {
				anchorScreenY = rect.height / 2;
			}
		} catch {
			// ignore
		}
		const anchorWorldY = (anchorScreenY - c.offsetY) / c.scale;
		try {
			c.__scrollNavAnchorMode = null;
		} catch {
			// ignore
		}
		if (!Number.isFinite(anchorWorldY)) {
			c.pendingScrollNavHighlight = null;
			return false;
		}
		anchorDayIndex = anchorWorldY / BASE_SPACING;
	}
	if (anchorDayIndex == null || !Number.isFinite(anchorDayIndex)) {
		c.pendingScrollNavHighlight = null;
		return false;
	}

	// For per-day navigation, treat a focused day as the current position.
	// Stepping should move to the next/previous *different* day (not re-focus the same day).
	const anchorValue = anchorDayIndex;

	const allowEqual = !anchorFromFocus;
	let chosenIndex = -1;
	let chosenDiff = direction >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
	for (let i = 0; i < dayTargets.length; i++) {
		const targetAtIndex = dayTargets[i];
		if (!targetAtIndex) continue;
		const pos = targetAtIndex.dayIndex;
		const diff = pos - anchorValue;
		if (direction >= 0) {
			if ((diff > 0 || (allowEqual && diff === 0)) && diff < chosenDiff) {
				chosenDiff = diff;
				chosenIndex = i;
			}
		} else if ((diff < 0 || (allowEqual && diff === 0)) && diff > chosenDiff) {
			chosenDiff = diff;
			chosenIndex = i;
		}
	}

	if (chosenIndex === -1) {
		if (!wrap) {
			if (typeof c.scrollNavIndex !== "number" || c.scrollNavIndex < 0 || c.scrollNavIndex >= dayTargets.length) {
				c.scrollNavIndex = direction >= 0 ? dayTargets.length - 1 : 0;
			}
			try {
				const boundaryIndex = direction >= 0 ? dayTargets.length - 1 : 0;
				const hoverGone =
					((c.hoverDateIndex == null && c.animDateIndex == null && c.hoverSummary == null && c.animSummary == null) ||
						Number(c.hoverTarget ?? 0) <= 0);
				if (c.scrollNavIndex === boundaryIndex && hoverGone) {
					const boundary = dayTargets[boundaryIndex];
					if (!boundary) {
						c.pendingScrollNavHighlight = null;
						return false;
					}
					c.animatingView = true;
					focusDateHelper(canvas, boundary.date, true, true, true);
					c.pendingScrollNavHighlight = null;
					return true;
				}
			} catch {
				// ignore
			}
			c.pendingScrollNavHighlight = null;
			return false;
		}
		c.scrollNavIndex = direction >= 0 ? 0 : dayTargets.length - 1;
		const wrapped = dayTargets[c.scrollNavIndex];
		if (!wrapped) {
			c.pendingScrollNavHighlight = null;
			return false;
		}
		try {
			c.scrollNavAnchorEntry = null;
			c.scrollNavAnchorDayIndex = wrapped.dayIndex;
		} catch {
			// ignore
		}
		c.animatingView = true;
		focusDateHelper(canvas, wrapped.date, true, true, true);
		c.pendingScrollNavHighlight = null;
		return true;
	}

	c.scrollNavIndex = chosenIndex;
	const target = dayTargets[chosenIndex];
	if (!target) {
		c.pendingScrollNavHighlight = null;
		return false;
	}
	try {
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = target.dayIndex;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, target.date, true, true, true);
	c.pendingScrollNavHighlight = null;
	return true;
}
