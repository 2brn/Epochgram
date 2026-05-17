import type { EpochCanvas } from "../epoch-canvas";
import { hideHoverPreview as hideHoverPreviewHelper } from "../epoch-canvas-hover";
import {
	BASE_SPACING,
	MIN_SCALE,
	MAX_SCALE,
	ZOOM_INTENSITY
} from "../epoch-canvas-constants";
import { resetScrollNavTargetState } from "../epoch-canvas/scroll-nav-reset";
import { getEventState, type CanvasEventInternals } from "./state";

function findSummaryCenterYFromLayouts(
	s: CanvasEventInternals,
	dayIndex: number,
	itemIndex: number
): number | null {
	try {
		const layout = s.layouts?.find((l: any) => l?.index === dayIndex) ?? null;
		if (!layout) return null;
		const rects: any[] =
			(Array.isArray((layout as any).summaryHoverRects) && (layout as any).summaryHoverRects.length > 0)
				? (layout as any).summaryHoverRects
				: (layout as any).summaryRects ?? [];
		const rect = rects.find((r: any) => r?.itemIndex === itemIndex) ?? null;
		if (rect && Number.isFinite(rect.y1) && Number.isFinite(rect.y2)) {
			return (Number(rect.y1) + Number(rect.y2)) / 2;
		}
	} catch {
		// ignore
	}
	return null;
}

function findDateCenterYFromLayouts(s: CanvasEventInternals, dayIndex: number): number | null {
	try {
		const layout = s.layouts?.find((l: any) => l?.index === dayIndex) ?? null;
		const rect = layout?.dateRect ?? null;
		if (rect && Number.isFinite(rect.y1) && Number.isFinite(rect.y2)) {
			return (Number(rect.y1) + Number(rect.y2)) / 2;
		}
	} catch {
		// ignore
	}
	return null;
}

type ShiftZoomAnchorLock =
	| { kind: "summary"; dayIndex: number; itemIndex: number; screenY: number }
	| { kind: "date"; dayIndex: number; screenY: number };

function resolveShiftZoomAnchorLock(canvas: EpochCanvas, s: CanvasEventInternals): ShiftZoomAnchorLock | null {
	const summaryFocus = s.hoverSummary ?? s.animSummary;
	if (summaryFocus) {
		const screenY =
			findSummaryCenterYFromLayouts(s, summaryFocus.dayIndex, summaryFocus.itemIndex) ??
			summaryFocus.dayIndex * BASE_SPACING * s.scale + s.offsetY;
		return { kind: "summary", dayIndex: summaryFocus.dayIndex, itemIndex: summaryFocus.itemIndex, screenY };
	}
	const dateFocus = s.hoverDateIndex ?? s.animDateIndex;
	if (dateFocus != null) {
		const screenY =
			findDateCenterYFromLayouts(s, dateFocus) ??
			dateFocus * BASE_SPACING * s.scale + s.offsetY;
		return { kind: "date", dayIndex: dateFocus, screenY };
	}

	// Fallback: keep the last scroll-nav-focused (or previously hovered) item pinned even
	// if hover got cleared (e.g., Alt key release, pointer leaving the canvas).
	try {
		const now = performance.now();
		const lastSummary = (s as any).__shiftZoomLastSummary as
			| { dayIndex: number; itemIndex: number; at?: number }
			| null
			| undefined;
		if (lastSummary && Number.isFinite(lastSummary.dayIndex) && Number.isFinite(lastSummary.itemIndex)) {
			const atRaw = Number((lastSummary as any).at);
			const ageOk = lastSummary.at == null || !Number.isFinite(atRaw) || atRaw <= 0 || now - atRaw <= 15000;
			if (ageOk) {
				const screenY =
					findSummaryCenterYFromLayouts(s, lastSummary.dayIndex, lastSummary.itemIndex) ??
					lastSummary.dayIndex * BASE_SPACING * s.scale + s.offsetY;
				return {
					kind: "summary",
					dayIndex: lastSummary.dayIndex,
					itemIndex: lastSummary.itemIndex,
					screenY
				};
			}
		}
		const lastDate = (s as any).__shiftZoomLastDate as
			| { dayIndex: number; at?: number }
			| null
			| undefined;
		if (lastDate && Number.isFinite(lastDate.dayIndex)) {
			const atRaw = Number((lastDate as any).at);
			const ageOk = lastDate.at == null || !Number.isFinite(atRaw) || atRaw <= 0 || now - atRaw <= 15000;
			if (ageOk) {
				const screenY =
					findDateCenterYFromLayouts(s, lastDate.dayIndex) ??
					lastDate.dayIndex * BASE_SPACING * s.scale + s.offsetY;
				return { kind: "date", dayIndex: lastDate.dayIndex, screenY };
			}
		}
	} catch {
		// ignore
	}
	const scrollAnchorDayIndex = canvas.getScrollAnchorDayIndex();
	if (scrollAnchorDayIndex != null) {
		// Only lock to a hovered/focused item for shift-zoom. Scroll-anchor lock is a fallback.
		return { kind: "date", dayIndex: scrollAnchorDayIndex, screenY: scrollAnchorDayIndex * BASE_SPACING * s.scale + s.offsetY };
	}
	return null;
}

function applyWheelPan(s: CanvasEventInternals, delta: number): void {
	if (!Number.isFinite(delta) || delta === 0) return;
	const dir = Math.sign(delta);
	if (dir === 0) return;
	if (s.animatingView) {
		s.scale = Number.isFinite(s.targetScale) ? s.targetScale : s.scale;
		s.animatingView = false;
	}
	const wasAnimatingWheelPan =
		(s as any).animatingWheelPan === true &&
		Number.isFinite(s.targetOffsetY) &&
		Number.isFinite(s.offsetY);
	if (wasAnimatingWheelPan) {
		const remaining = s.targetOffsetY - s.offsetY;
		if (remaining !== 0 && Math.sign(remaining) === dir) {
			(s as any).animatingWheelPan = false;
			s.targetOffsetY = s.offsetY;
		}
	}
	const base =
		(s as any).animatingWheelPan === true && Number.isFinite(s.targetOffsetY)
			? s.targetOffsetY
			: s.offsetY;
	s.targetOffsetY = base - delta;
	s.targetScale = s.scale;
	(s as any).animatingWheelPan = true;
}

function applyWheelZoomAnimated(
	canvas: EpochCanvas,
	s: CanvasEventInternals,
	event: WheelEvent,
	anchorY: number
): void {
	const deltaY = Number(event.deltaY) || 0;
	if (!Number.isFinite(deltaY) || deltaY === 0) return;

	const dir = Math.sign(-deltaY);
	if (dir === 0) return;

	const wasAnimating = (s as any).animatingWheelZoom === true;
	const prevDir = Number((s as any).wheelZoomDir) || 0;
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

	// Cancel other view motion modes; wheel zoom owns scale/offset while active.
	s.animatingView = false;
	(s as any).animatingWheelPan = false;
	(s as any).animatingWheelZoom = true;
	(s as any).wheelZoomDir = dir;
	(s as any).wheelZoomAnchorY = anchorY;
	(s as any).wheelZoomAnchorWorldY = worldY;

	s.targetScale = nextScale;
	s.targetOffsetY = nextOffsetY;
}

export function handleWheel(canvas: EpochCanvas, event: WheelEvent): void {
	const s = getEventState(canvas);
	event.preventDefault();
	const now = performance.now();
	try {
		const prev = Number((s as any).suppressClickUntil ?? 0);
		(s as any).suppressClickUntil = Math.max(prev, now + 200);
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
		(s as any).animatingWheelPan = false;
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
		const hoverNow = performance.now();
		s.suppressHoverUntil = hoverNow + 180;
		s.suppressHoverUntilPointerMove = true;
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
		(s as any).hoverAnim = 0;
		(s as any).hoverEaseStartAt = null;
		(s as any).hoverEaseFrom = 0;
		(s as any).hoverEaseTo = 0;
		(s as any).outgoingSummaries = [];
		(s as any).outgoingDates = [];

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

			// Shift+zoom is expected to keep the hovered item pinned, even if the layout changes
			// due to hover suppression, dense/compact transitions, or packing rules.
			if (shiftLock && Number.isFinite(shiftLock.screenY)) {
				try {
					// First draw computes the new layouts/rects at the updated scale.
					s.draw();
					const newCenterY =
						shiftLock.kind === "summary"
							? findSummaryCenterYFromLayouts(s, shiftLock.dayIndex, shiftLock.itemIndex)
							: findDateCenterYFromLayouts(s, shiftLock.dayIndex);
					if (newCenterY != null && Number.isFinite(newCenterY)) {
						s.offsetY += shiftLock.screenY - newCenterY;
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
