import type { EpochCanvas } from "../epoch-canvas";
import { hideHoverPreview as hideHoverPreviewHelper } from "../epoch-canvas-hover";
import {
	BASE_SPACING,
	MIN_SCALE,
	MAX_SCALE,
	ZOOM_INTENSITY
} from "../epoch-canvas-constants";
import { clampTimelineOffsetToBounds, resolveViewportHeight } from "../epoch-canvas/viewport-limits";
import { dateKeyToDate, getDayIndexForDate } from "../epoch-canvas-focus";
import { resetScrollNavTargetState } from "../epoch-canvas/scroll-nav-reset";
import { getEventState, type CanvasEventInternals } from "./state";

type ShiftZoomAnchorLock =
	| { kind: "date"; dayIndex: number; screenY: number };

type WheelState = CanvasEventInternals & {
	getToday?(): Date;
	activeFilePath?: string;
	animatingWheelPan?: boolean;
	animatingWheelZoom?: boolean;
	wheelZoomDir?: number;
	wheelZoomAnchorY?: number;
	wheelZoomAnchorWorldY?: number;
	suppressClickUntil?: number;
	__lastKnownCanvasCssHeight?: number;
	hoverAnim?: number;
	hoverEaseStartAt?: number | null;
	hoverEaseFrom?: number;
	hoverEaseTo?: number;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	outgoingDates?: Array<{ index: number; t: number }> | null;
	previewLockedUntilAltRelease?: boolean;
	hoverPreviewKey?: string | null;
	viewInteractionUntil?: number;
	suppressHoverUntil?: number;
	suppressHoverUntilPointerMove?: boolean;
	keepHoverUntilPointerMove?: boolean;
};

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

function resolveToday(state: WheelState): Date | null {
	try {
		if (typeof state.getToday === "function") return state.getToday();
	} catch {
		// ignore
	}
	return null;
}

function resolveCurrentScrollNavDayIndex(canvas: EpochCanvas): number | null {
	const c = canvas as unknown as {
		pendingScrollNavHighlight?: { dayIndex?: number } | null;
		scrollNavAnchorDayIndex?: number | null;
		scrollNavAnchorEntry?: { date?: string | null } | null;
	};
	try {
		const pending = c?.pendingScrollNavHighlight ?? null;
		const pendingDay = pending?.dayIndex;
		if (typeof pendingDay === "number" && Number.isFinite(pendingDay)) return pendingDay;
	} catch {
		// ignore
	}
	try {
		const explicitDay = c?.scrollNavAnchorDayIndex;
		if (typeof explicitDay === "number" && Number.isFinite(explicitDay)) return explicitDay;
	} catch {
		// ignore
	}
	try {
		const anchorEntry = c?.scrollNavAnchorEntry ?? null;
		const dk = String(anchorEntry?.date ?? "").trim();
		if (!dk) return null;
		const dt = dateKeyToDate(dk);
		if (!dt) return null;
		return getDayIndexForDate(canvas, dt);
	} catch {
		// ignore
	}
	return null;
}

function resolveActiveRecordDayIndex(canvas: EpochCanvas, activePath: string): number | null {
	const c = canvas as unknown as {
		scrollNavAnchorEntry?: { file?: string | null; date?: string | null; recurring?: boolean } | null;
		scrollNavAnchorDayIndex?: number | null;
		pendingScrollNavHighlight?: { dayIndex?: number; entry?: { file?: string | null } | null } | null;
		index?: Record<string, Array<{ file?: string | null; recurring?: boolean } | null>>;
	};
	try {
		const anchorEntry = c?.scrollNavAnchorEntry ?? null;
		if (anchorEntry && String(anchorEntry.file ?? "") === activePath) {
			const explicitDay = c?.scrollNavAnchorDayIndex;
			if (typeof explicitDay === "number" && Number.isFinite(explicitDay)) {
				return explicitDay;
			}
			const dk = String(anchorEntry.date ?? "").trim();
			if (dk) {
				const dt = dateKeyToDate(dk);
				if (dt) return getDayIndexForDate(canvas, dt);
			}
		}
	} catch {
		// ignore
	}

	try {
		const pending = c?.pendingScrollNavHighlight ?? null;
		const pendingEntry = pending?.entry ?? null;
		if (pendingEntry && String(pendingEntry.file ?? "") === activePath) {
			const idx = pending?.dayIndex;
			if (typeof idx === "number" && Number.isFinite(idx)) return idx;
		}
	} catch {
		// ignore
	}

	try {
		const index = c?.index;
		if (!index || typeof index !== "object") return null;

		let bestNonRecurringMs: number | null = null;
		let bestNonRecurringDate: Date | null = null;
		let bestRecurringMs: number | null = null;
		let bestRecurringDate: Date | null = null;

		for (const [dateKey, entries] of Object.entries(index)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			let hasNonRecurring = false;
			let hasRecurring = false;
			for (const entry of entries) {
				if (!entry) continue;
				if (String(entry.file ?? "") !== activePath) continue;
				if (entry.recurring === true) hasRecurring = true;
				else hasNonRecurring = true;
			}
			if (!hasNonRecurring && !hasRecurring) continue;
			const dt = dateKeyToDate(String(dateKey));
			if (!dt) continue;
			const ms = dt.getTime();
			if (!Number.isFinite(ms)) continue;
			if (hasNonRecurring && (bestNonRecurringMs == null || ms > bestNonRecurringMs)) {
				bestNonRecurringMs = ms;
				bestNonRecurringDate = dt;
			}
			if (hasRecurring && (bestRecurringMs == null || ms < bestRecurringMs)) {
				bestRecurringMs = ms;
				bestRecurringDate = dt;
			}
		}

		const chosen = (() => {
			if (!bestNonRecurringDate) return bestRecurringDate;
			if (!bestRecurringDate) return bestNonRecurringDate;
			return (bestNonRecurringMs ?? -Infinity) >= (bestRecurringMs ?? Infinity)
				? bestNonRecurringDate
				: bestRecurringDate;
		})();
		if (!chosen) return null;
		return getDayIndexForDate(canvas, chosen);
	} catch {
		// ignore
	}

	return null;
}

function resolveShiftZoomAnchorLock(canvas: EpochCanvas, s: CanvasEventInternals): ShiftZoomAnchorLock | null {
	const state = s as WheelState;
	const canvasState = canvas as unknown as { activeFilePath?: string };
	const activePath = String(state.activeFilePath ?? canvasState.activeFilePath ?? "").trim();
	const scrollAnchorDayIndex = resolveCurrentScrollNavDayIndex(canvas);

	// Shift-zoom policy:
	// - If there is an explicit current scroll-nav date, anchor to that first.
	// - Otherwise, if there is an active/opened file, anchor to the day circle for that
	//   opened record (resolved from active-file record state).
	if (activePath) {
		if (scrollAnchorDayIndex != null) {
			return {
				kind: "date",
				dayIndex: scrollAnchorDayIndex,
				screenY: scrollAnchorDayIndex * BASE_SPACING * s.scale + s.offsetY
			};
		}
		const openedRecordDayIndex = resolveActiveRecordDayIndex(canvas, activePath);
		if (openedRecordDayIndex != null) {
			return {
				kind: "date",
				dayIndex: openedRecordDayIndex,
				screenY: openedRecordDayIndex * BASE_SPACING * s.scale + s.offsetY
			};
		}
	}
	if (scrollAnchorDayIndex != null) {
		// No active file: use scroll-nav day fallback.
		return { kind: "date", dayIndex: scrollAnchorDayIndex, screenY: scrollAnchorDayIndex * BASE_SPACING * s.scale + s.offsetY };
	}
	return null;
}

function applyWheelPan(s: CanvasEventInternals, delta: number): void {
	const state = s as WheelState;
	if (!Number.isFinite(delta) || delta === 0) return;
	const dir = Math.sign(delta);
	if (dir === 0) return;
	if (s.animatingView) {
		s.scale = Number.isFinite(s.targetScale) ? s.targetScale : s.scale;
		s.animatingView = false;
	}
	const wasAnimatingWheelPan =
		state.animatingWheelPan === true &&
		Number.isFinite(s.targetOffsetY) &&
		Number.isFinite(s.offsetY);
	if (wasAnimatingWheelPan) {
		const remaining = s.targetOffsetY - s.offsetY;
		if (remaining !== 0 && Math.sign(remaining) === dir) {
			state.animatingWheelPan = false;
			s.targetOffsetY = s.offsetY;
		}
	}
	const base =
		state.animatingWheelPan === true && Number.isFinite(s.targetOffsetY)
			? s.targetOffsetY
			: s.offsetY;
	const viewportHeight = resolveViewportHeight(s.root, Number(state.__lastKnownCanvasCssHeight ?? 0));
	const nextTargetOffset = base - delta;
	const today = resolveToday(s);
	s.targetOffsetY = viewportHeight > 0
		? clampTimelineOffsetToBounds({
			offsetY: nextTargetOffset,
			scale: s.scale,
			viewportHeight,
			today: today ?? new Date()
		})
		: nextTargetOffset;
	if (!today) {
		s.targetOffsetY = nextTargetOffset;
	}
	s.targetScale = s.scale;
	state.animatingWheelPan = true;
}

function applyWheelZoomAnimated(
	canvas: EpochCanvas,
	s: CanvasEventInternals,
	event: WheelEvent,
	anchorY: number
): void {
	const state = s as WheelState;
	const deltaY = Number(event.deltaY) || 0;
	if (!Number.isFinite(deltaY) || deltaY === 0) return;

	const dir = Math.sign(-deltaY);
	if (dir === 0) return;

	const wasAnimating = state.animatingWheelZoom === true;
	const prevDir = Number(state.wheelZoomDir) || 0;
	const reversing = wasAnimating && prevDir !== 0 && prevDir !== dir;

	const baseScale = (() => {
		if (!wasAnimating) return s.scale;
		if (reversing) return s.scale;
		return Number.isFinite(s.targetScale) ? s.targetScale : s.scale;
	})();
	const baseOffsetY = (() => {
		if (!wasAnimating) return s.offsetY;
		if (reversing) return s.offsetY;
		return Number.isFinite(s.targetOffsetY) ? s.targetOffsetY : s.offsetY;
	})();

	const zoomFactor = Math.exp(-deltaY * ZOOM_INTENSITY);
	let nextScale = baseScale * zoomFactor;
	nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));

	const worldY = (anchorY - baseOffsetY) / baseScale;
	const nextOffsetY = anchorY - worldY * nextScale;
	const viewportHeight = resolveViewportHeight(s.root, Number(state.__lastKnownCanvasCssHeight ?? 0));
	const today = resolveToday(s);
	const clampedOffsetY = viewportHeight > 0
		? clampTimelineOffsetToBounds({
			offsetY: nextOffsetY,
			scale: nextScale,
			viewportHeight,
			today: today ?? new Date()
		})
		: nextOffsetY;

	// Cancel other view motion modes; wheel zoom owns scale/offset while active.
	s.animatingView = false;
	state.animatingWheelPan = false;
	state.animatingWheelZoom = true;
	state.wheelZoomDir = dir;
	state.wheelZoomAnchorY = anchorY;
	state.wheelZoomAnchorWorldY = worldY;

	s.targetScale = nextScale;
	s.targetOffsetY = today ? clampedOffsetY : nextOffsetY;
}

export function handleWheel(canvas: EpochCanvas, event: WheelEvent): void {
	const s = getEventState(canvas);
	const state = s as WheelState;
	event.preventDefault();
	const now = nowMs();
	try {
		const prev = Number(state.suppressClickUntil ?? 0);
		state.suppressClickUntil = Math.max(prev, now + 200);
	} catch {
		// ignore
	}
	if (event.altKey && !event.ctrlKey && !event.metaKey) {
		// Match Alt+Up/Down behavior: alt modifies scroll-nav, and should not trigger pan/zoom
		// interaction gating (which can suppress hover/outgoing animations).
		if (!event.shiftKey) {
			// Only vertical wheel movement matters.
			const dy = Number(event.deltaY) || 0;
			if (dy !== 0) {
				const direction = dy > 0 ? 1 : -1;
				s.advanceScrollNav(direction);
				s.previewLockedUntilAltRelease = true;
				s.hoverPreviewKey = null;
				hideHoverPreviewHelper(canvas);
			}
		}
		return;
	}
	if (s.epochsView && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
		resetScrollNavTargetState(canvas);
		s.viewInteractionUntil = now + 140;
		const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
		applyWheelPan(s, dominantDelta);
		s.suppressHoverUntil = now + 180;
		s.suppressHoverUntilPointerMove = true;
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
		s.draw();
		s.requestHoverAnimation();
		return;
	}
	if (event.ctrlKey || event.metaKey || (event.shiftKey && !event.altKey && !event.metaKey)) {
		s.animatingView = false;
		state.animatingWheelPan = false;
		// Shift-only wheel zoom remains instant (for the shift-lock pinned-hover correction pass).
		// Ctrl/meta wheel zoom is animated via animatingWheelZoom.
		// Treat active zoom as an "animating" period for perf gating.
		s.viewInteractionUntil = now + 140;
		const rect = s.canvas.getBoundingClientRect();
		let anchorY = event.clientY - rect.top;
		const shiftLock = event.shiftKey && !event.altKey && !event.metaKey ? resolveShiftZoomAnchorLock(canvas, s) : null;
		if (shiftLock && Number.isFinite(shiftLock.screenY)) {
			anchorY = shiftLock.screenY;
		}

		// Zoom input should not trigger hover (across all render modes).
		// Clear hover immediately (no hover-out animation) and keep it suppressed until the user moves the pointer.
		const hoverNow = nowMs();
		s.suppressHoverUntil = hoverNow + 180;
		s.suppressHoverUntilPointerMove = true;
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
		state.hoverAnim = 0;
		state.hoverEaseStartAt = null;
		state.hoverEaseFrom = 0;
		state.hoverEaseTo = 0;
		state.outgoingSummaries = [];
		state.outgoingDates = [];

		if (event.ctrlKey || event.metaKey) {
			applyWheelZoomAnimated(canvas, s, event, anchorY);
		} else {
			const prevScale = s.scale;
			const zoomFactor = Math.exp(-event.deltaY * ZOOM_INTENSITY);

			let newScale = s.scale * zoomFactor;
			newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

			const worldY = (anchorY - s.offsetY) / prevScale;
			s.scale = newScale;
			s.offsetY = anchorY - worldY * s.scale;
			const viewportHeight = resolveViewportHeight(s.root, Number(state.__lastKnownCanvasCssHeight ?? 0));
			if (viewportHeight > 0) {
				const today = resolveToday(s);
				s.offsetY = clampTimelineOffsetToBounds({
					offsetY: s.offsetY,
					scale: s.scale,
					viewportHeight,
					today: today ?? new Date()
				});
				if (!today) {
					s.offsetY = anchorY - worldY * s.scale;
				}
			}

			// Shift+zoom is expected to keep the hovered item pinned, even if the layout changes
			// due to hover suppression, dense/compact transitions, or packing rules.
			if (shiftLock && Number.isFinite(shiftLock.screenY)) {
				try {
					// First draw computes the new layouts/rects at the updated scale.
					s.draw();
					const newCenterY = shiftLock.dayIndex * BASE_SPACING * s.scale + s.offsetY;
					if (newCenterY != null && Number.isFinite(newCenterY)) {
						s.offsetY += shiftLock.screenY - newCenterY;
						if (viewportHeight > 0) {
							const today = resolveToday(s);
							s.offsetY = clampTimelineOffsetToBounds({
								offsetY: s.offsetY,
								scale: s.scale,
								viewportHeight,
								today: today ?? new Date()
							});
						}
					}
				} catch {
					// ignore
				}
			}
		}
	} else {
		s.viewInteractionUntil = now + 140;
		resetScrollNavTargetState(canvas);
		applyWheelPan(s, event.deltaY);
		s.suppressHoverUntil = now + 180;
		s.suppressHoverUntilPointerMove = true;
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
	}
	// Draw immediately for responsiveness, but also keep the animation loop running
	// so zoom-driven fades/packing transitions can finish without needing another input.
	s.draw();
	s.requestHoverAnimation();
}
