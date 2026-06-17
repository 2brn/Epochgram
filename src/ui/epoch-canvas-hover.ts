import type { EpochCanvas } from "./epoch-canvas";
import { DATE_TOUCH_HIT_PAD } from "./epoch-canvas-constants";
import { hoverState, pushOutgoingDate, pushOutgoingSummary, takeOutgoingDateT, takeOutgoingSummaryT } from "./epoch-canvas-hover/internals";
import { setCssStyles } from "../dom";
export {
	attemptHoverPreview,
	hideHoverPreview,
	onWindowKeyDown,
	onWindowKeyUp,
} from "./epoch-canvas-hover/preview";

export { findDayLayoutAtPoint, findSummaryEntryAtPoint } from "./epoch-canvas-hover/hit-test";

export function clearSummaryHover(canvas: EpochCanvas, force = false): void {
	const state = hoverState(canvas);
	try {
		if (!force && typeof state.isPointerDeviceEvent === "function" && !state.isPointerDeviceEvent()) {
			const until = Number((state as any).__touchHoverPinnedUntil ?? 0);
			if (Number.isFinite(until) && until > 0 && performance.now() < until) {
				return;
			}
		}
	} catch {
		// ignore
	}
	if (!force && state.keepHoverUntilPointerMove) return;
	const hadSummary = state.hoverSummary != null || state.animSummary != null;
	if (!hadSummary) return;
	if (force) {
		state.keepHoverUntilPointerMove = false;
	}
	(state as any).hoverGraceUntil = null;
	state.hoverSummary = null;
	// Keep animSummary during hover-out so the summary can animate back to normal.
	if (force) {
		state.animSummary = null;
	}
	(state as any).prevAnimSummary = null;
	(state as any).prevAnimDateIndex = null;
	if (force) {
		(state as any).outgoingSummaries = [];
		(state as any).outgoingDates = [];
	}
	state.hoverOverlay = null;
	state.hoverPreviewKey = null;
	state.lastPointerEvent = null;
	setCssStyles(state.canvas, { cursor: "default" });
	state.hoverTarget = 0;
	state.requestHoverAnimation();
}

export function clearHover(canvas: EpochCanvas, force = false): void {
	const state = hoverState(canvas);
	try {
		if (!force && typeof state.isPointerDeviceEvent === "function" && !state.isPointerDeviceEvent()) {
			const until = Number((state as any).__touchHoverPinnedUntil ?? 0);
			if (Number.isFinite(until) && until > 0 && performance.now() < until) {
				return;
			}
		}
	} catch {
		// ignore
	}
	if (!force && state.keepHoverUntilPointerMove) return;
	state.keepHoverUntilPointerMove = false;
	state.cancelFocusClear();
	if (state.hoverDateIndex == null && state.hoverSummary == null) return;
	(state as any).hoverGraceUntil = null;
	state.hoverDateIndex = null;
	state.hoverSummary = null;
	(state as any).prevAnimSummary = null;
	(state as any).prevAnimDateIndex = null;
	if (force) {
		(state as any).outgoingSummaries = [];
		(state as any).outgoingDates = [];
	}
	state.hoverPreviewKey = null;
	state.lastPointerEvent = null;
	setCssStyles(state.canvas, { cursor: "default" });
	state.hoverTarget = 0;
	state.requestHoverAnimation();
}

export function updateHover(canvas: EpochCanvas, x: number, y: number): void {
	const state = hoverState(canvas);
	const now = performance.now();
	if (Number.isFinite((state as any).suppressHoverUntil) && now < Number((state as any).suppressHoverUntil)) {
		return;
	}
	// Hover suppression is enforced by the event layer (mouse/touch). Some platforms emit
	// stray hover updates after gesture navigation; do not clear suppression here.
	if ((state as any).suppressHoverUntilPointerMove) {
		return;
	}
	state.cancelFocusClear();
	if (state.keepHoverUntilPointerMove) {
		state.keepHoverUntilPointerMove = false;
	}

	const pointInRect = (rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
		return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
	};

	const centerYDist = (rect: { x1: number; y1: number; x2: number; y2: number }): number => {
		if (!pointInRect(rect)) return -1;
		const centerY = (rect.y1 + rect.y2) / 2;
		return Math.abs(centerY - y);
	};

	const current = state.hoverSummary;
	let currentStableRect: { x1: number; y1: number; x2: number; y2: number } | null = null;
	let currentAnimatedRect: { x1: number; y1: number; x2: number; y2: number } | null = null;
	if (current) {
		for (const layout of state.layouts) {
			if (layout.index !== current.dayIndex) continue;
			const stableRects = (layout as any).summaryHoverRects ?? layout.summaryRects;
			for (const rect of stableRects) {
				if (rect.itemIndex === current.itemIndex) {
					currentStableRect = rect;
					break;
				}
			}
			for (const rect of layout.summaryRects) {
				if (rect.itemIndex === current.itemIndex) {
					currentAnimatedRect = rect;
					break;
				}
			}
			break;
		}
	}

	let bestSummary: { dayIndex: number; itemIndex: number; dist: number } | null = null;
	for (const layout of state.layouts) {
		const stableRects = (layout as any).summaryHoverRects ?? layout.summaryRects;
		const animatedRects = layout.summaryRects;
		const rectByItem = new Map<number, { itemIndex: number; x1: number; y1: number; x2: number; y2: number }>();
		for (const rect of stableRects) {
			rectByItem.set(rect.itemIndex, { itemIndex: rect.itemIndex, x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 });
		}
		for (const rect of animatedRects) {
			const prev = rectByItem.get(rect.itemIndex);
			if (!prev) {
				rectByItem.set(rect.itemIndex, { itemIndex: rect.itemIndex, x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 });
				continue;
			}
			prev.x1 = Math.min(prev.x1, rect.x1);
			prev.y1 = Math.min(prev.y1, rect.y1);
			prev.x2 = Math.max(prev.x2, rect.x2);
			prev.y2 = Math.max(prev.y2, rect.y2);
		}
		for (const rect of rectByItem.values()) {
			const dist = centerYDist(rect);
			if (dist < 0) continue;
			if (!bestSummary || dist < bestSummary.dist - 0.01) {
				bestSummary = { dayIndex: layout.index, itemIndex: rect.itemIndex, dist };
				continue;
			}
			// Tie-break: prefer the current hovered item to avoid edge flicker.
			if (
				bestSummary &&
				Math.abs(dist - bestSummary.dist) <= 0.01 &&
				current &&
				layout.index === current.dayIndex &&
				rect.itemIndex === current.itemIndex
			) {
				bestSummary = { dayIndex: layout.index, itemIndex: rect.itemIndex, dist };
			}
		}
	}

	if (bestSummary) {
		(state as any).hoverGraceUntil = null;
		if (
			state.hoverSummary &&
			state.hoverSummary.dayIndex === bestSummary.dayIndex &&
			state.hoverSummary.itemIndex === bestSummary.itemIndex &&
			state.hoverTarget === 1
		) {
			setCssStyles(state.canvas, { cursor: "pointer" });
			return;
		}

		if (state.animDateIndex != null) {
			pushOutgoingDate(state as any, state.animDateIndex, Number((state as any).hoverAnim) || 0);
			(state as any).prevAnimDateIndex = state.animDateIndex;
			state.animDateIndex = null;
			state.hoverDateIndex = null;
			(state as any).hoverAnim = 0;
			(state as any).hoverEaseStartAt = null;
		}
		state.hoverSummary = { dayIndex: bestSummary.dayIndex, itemIndex: bestSummary.itemIndex };
		const resumeSummaryT = takeOutgoingSummaryT(state as any, { dayIndex: bestSummary.dayIndex, itemIndex: bestSummary.itemIndex });
		// When switching summaries, always restart hover ease from normal so fast moves
		// (including brief gaps where hoverTarget may have been set to 0) never snap.
		if (state.animSummary &&
			(state.animSummary.dayIndex !== bestSummary.dayIndex || state.animSummary.itemIndex !== bestSummary.itemIndex)
		) {
			// If we switch before the hover ease has advanced, hoverAnim can be 0.
			// Do not apply a large floor here; it can cause a visible "blink" when skimming across rows.
			const currT = Number((state as any).hoverAnim) || 0;
			pushOutgoingSummary(state as any, state.animSummary, Math.max(0, Math.min(1, currT)));
			(state as any).hoverAnim = resumeSummaryT > 0.001 ? resumeSummaryT : 0;
			(state as any).hoverEaseStartAt = null;
		}
		state.animSummary = { dayIndex: bestSummary.dayIndex, itemIndex: bestSummary.itemIndex };
		// If we're re-entering a summary that was animating out, ensure the ease starts from that position.
		if (resumeSummaryT > 0.001 && (Number((state as any).hoverAnim) || 0) <= 0.001) {
			(state as any).hoverAnim = resumeSummaryT;
			(state as any).hoverEaseStartAt = null;
		}
		setCssStyles(state.canvas, { cursor: "pointer" });
		state.hoverTarget = 1;
		state.requestHoverAnimation();
		return;
	}

	// No candidate: keep the current hover if we're still inside its (animated or stable) hit area.
	if (current && ((currentAnimatedRect && pointInRect(currentAnimatedRect)) || (currentStableRect && pointInRect(currentStableRect)))) {
		(state as any).hoverGraceUntil = null;
		setCssStyles(state.canvas, { cursor: "pointer" });
		return;
	}

	const dateHitPad = (() => {
		try {
			if (typeof state.isPointerDeviceEvent === "function" && !state.isPointerDeviceEvent()) {
				const p = Number(DATE_TOUCH_HIT_PAD);
				return Number.isFinite(p) && p > 0 ? p : 0;
			}
		} catch {
			// ignore
		}
		return 0;
	})();

	let bestDate: { index: number; dist: number } | null = null;
	for (const layout of state.layouts) {
		if (!layout.hasVisibleDate) continue;
		const rect = layout.dateRect;
		if (x >= rect.x1 - dateHitPad && x <= rect.x2 + dateHitPad && y >= rect.y1 - dateHitPad && y <= rect.y2 + dateHitPad) {
			const centerY = (rect.y1 + rect.y2) / 2;
			const dist = Math.abs(centerY - y);
			if (!bestDate || dist < bestDate.dist) {
				bestDate = { index: layout.index, dist };
			}
		}
	}

	if (bestDate) {
		(state as any).hoverGraceUntil = null;
		state.keepHoverUntilPointerMove = false;
		const resumeDateT = takeOutgoingDateT(state as any, bestDate.index);
		// Restart ease when switching hover kind (summary -> date or date -> different date)
		// so the target highlight always animates from normal.
		if (
			state.hoverTarget === 1 &&
			(state.animSummary != null || (state.animDateIndex != null && state.animDateIndex !== bestDate.index))
		) {
			if (state.animSummary) {
				pushOutgoingSummary(state as any, state.animSummary, Math.max(0.35, Number((state as any).hoverAnim) || 0));
			}
			if (state.animDateIndex != null && state.animDateIndex !== bestDate.index) {
				pushOutgoingDate(state as any, state.animDateIndex, Number((state as any).hoverAnim) || 0);
				(state as any).prevAnimDateIndex = state.animDateIndex;
			}
			(state as any).hoverAnim = resumeDateT > 0.001 ? resumeDateT : 0;
			(state as any).hoverEaseStartAt = null;
			(state as any).prevAnimSummary = null;
		}
		// When switching dates, keep the previous date animating out.
		if (state.animDateIndex != null && state.animDateIndex !== bestDate.index) {
			pushOutgoingDate(state as any, state.animDateIndex, Number((state as any).hoverAnim) || 0);
			(state as any).hoverAnim = 0;
			(state as any).hoverEaseStartAt = null;
			(state as any).prevAnimDateIndex = state.animDateIndex;
		}
		state.hoverSummary = null;
		state.hoverDateIndex = bestDate.index;
		state.animSummary = null;
		state.animDateIndex = bestDate.index;
		setCssStyles(state.canvas, { cursor: "pointer" });
		state.hoverTarget = 1;
		state.requestHoverAnimation();
		return;
	}

	if (state.hoverSummary != null || state.hoverDateIndex != null) {
		// Grace period: when moving quickly between summaries, the pointer can briefly pass
		// through empty space (no hit rect). Avoid collapsing hover/layout for a frame.
		if (state.hoverTarget === 1 && (state.animSummary != null || state.animDateIndex != null)) {
			const graceUntil = Number((state as any).hoverGraceUntil);
			if (!Number.isFinite(graceUntil) || graceUntil <= 0) {
				const graceMs = 24;
				const until = now + graceMs;
				(state as any).hoverGraceUntil = until;
				// If the pointer stops moving after leaving a hit area, we still need to
				// clear hover once the grace window expires.
				try {
					const prevTimer = Number((state as any).__hoverGraceTimerId);
					if (Number.isFinite(prevTimer) && prevTimer > 0) {
						window.clearTimeout(prevTimer);
					}
				} catch {
					// ignore
				}
				const token = (Number((state as any).__hoverGraceToken) || 0) + 1;
				(state as any).__hoverGraceToken = token;
				try {
					(state as any).__hoverGraceTimerId = window.setTimeout(() => {
						try {
							const st = hoverState(canvas) as any;
							if (Number(st.__hoverGraceToken) !== token) return;
							const u = Number(st.hoverGraceUntil);
							if (!Number.isFinite(u) || u !== until) return;
							if (performance.now() < u) return;
							st.hoverGraceUntil = null;
							st.keepHoverUntilPointerMove = false;
							if (st.hoverTarget === 1) {
								if (st.animSummary) {
									pushOutgoingSummary(st, st.animSummary, Math.max(0, Math.min(1, Number(st.hoverAnim) || 0)));
								}
								if (st.animDateIndex != null) {
									pushOutgoingDate(st, st.animDateIndex, Number(st.hoverAnim) || 0);
								}
							}
							st.hoverSummary = null;
							st.hoverDateIndex = null;
							st.prevAnimSummary = null;
							st.prevAnimDateIndex = null;
							setCssStyles(st.canvas, { cursor: "default" });
							st.hoverTarget = 0;
							st.requestHoverAnimation();
						} catch {
							// ignore
						}
					}, graceMs + 8);
				} catch {
					// ignore
				}
				setCssStyles(state.canvas, { cursor: "default" });
				return;
			}
			if (now < graceUntil) {
				setCssStyles(state.canvas, { cursor: "default" });
				return;
			}
			(state as any).hoverGraceUntil = null;
		}

		state.keepHoverUntilPointerMove = false;
		// If we momentarily lose hover while moving quickly between items, preserve a smooth
		// hover-out for the previously-animated target so it doesn't snap back to normal.
		if (state.hoverTarget === 1) {
			if (state.animSummary) {
				pushOutgoingSummary(state as any, state.animSummary, Math.max(0, Math.min(1, Number((state as any).hoverAnim) || 0)));
			}
			if (state.animDateIndex != null) {
				pushOutgoingDate(state as any, state.animDateIndex, Number((state as any).hoverAnim) || 0);
			}
		}
		state.hoverSummary = null;
		state.hoverDateIndex = null;
		(state as any).prevAnimSummary = null;
		(state as any).prevAnimDateIndex = null;
		setCssStyles(state.canvas, { cursor: "default" });
		state.hoverTarget = 0;
		state.requestHoverAnimation();
	}
}
