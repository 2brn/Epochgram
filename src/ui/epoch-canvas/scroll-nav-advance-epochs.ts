import type { EpochCanvas } from "../epoch-canvas";

import { focusDate as focusDateHelper } from "../epoch-canvas-focus";
import { BASE_SPACING } from "../epoch-canvas-constants";
import { computeVisibleScrollNavDayTargets } from "./scroll-nav-targets";

type PendingHighlight = { dayIndex?: number | null } | null;

type ScrollNavEpochsState = {
	scrollNavIndex: number;
	pendingScrollNavHighlight: PendingHighlight;
	hoverSummary: { dayIndex?: number | null } | null;
	animSummary: { dayIndex?: number | null } | null;
	hoverDateIndex: number | null;
	animDateIndex: number | null;
	scrollNavAnchorDayIndex?: number | null;
	scrollNavAnchorEntry?: unknown;
	animatingView: boolean;
	offsetY: number;
	scale: number;
	hoverTarget?: number;
	__scrollNavAnchorMode?: string | null;
};

export function advanceScrollNavEpochsView(params: {
	canvas: EpochCanvas;
	c: ScrollNavEpochsState;
	direction: number;
	wrap: boolean;
	prevPending: PendingHighlight;
	rect: DOMRect;
}): boolean {
	const { canvas, c, direction, wrap, prevPending, rect } = params;

	const dayTargets = computeVisibleScrollNavDayTargets(canvas);
	if (dayTargets.length === 0) {
		c.scrollNavIndex = -1;
		c.pendingScrollNavHighlight = null;
		return false;
	}

	let anchorDayIndex: number | null = null;
	let anchorFromFocus = false;
	if (prevPending && typeof prevPending.dayIndex === "number" && Number.isFinite(prevPending.dayIndex)) {
		anchorDayIndex = prevPending.dayIndex;
		anchorFromFocus = true;
		const idx = dayTargets.findIndex((d) => d.dayIndex === anchorDayIndex);
		if (idx >= 0) {
			c.scrollNavIndex = idx;
		}
	}
	if (anchorDayIndex == null) {
		const summaryFocus = c.hoverSummary ?? c.animSummary;
		if (summaryFocus && typeof summaryFocus.dayIndex === "number" && Number.isFinite(summaryFocus.dayIndex)) {
			anchorDayIndex = summaryFocus.dayIndex;
			anchorFromFocus = true;
		}
	}
	if (anchorDayIndex == null) {
		const dateFocus = c.hoverDateIndex ?? c.animDateIndex;
		if (dateFocus != null) {
			anchorDayIndex = dateFocus;
			anchorFromFocus = true;
		}
	}
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
		typeof c.scrollNavIndex === "number" &&
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

	const anchorValue = anchorDayIndex;
	const allowEqual = !anchorFromFocus;
	let chosenIndex = -1;
	let chosenDiff = direction >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
	for (let i = 0; i < dayTargets.length; i++) {
		const pos = dayTargets[i].dayIndex;
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
					try {
						c.scrollNavAnchorEntry = null;
						c.scrollNavAnchorDayIndex = boundary.dayIndex;
					} catch {
						// ignore
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
