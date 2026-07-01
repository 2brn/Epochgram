import type { EpochCanvas } from "../epoch-canvas";
import { resetScrollNavTargetState } from "../epoch-canvas/scroll-nav-reset";
import { getEventState, isViewMotionActive, isWheelInteractionSuppressed, stopViewMotion } from "./state";
import type { CanvasEventInternals } from "./state";
import { beginAnchorEntryDrag, commitAnchorEntryDrag, resolveDraggableAnchorEntry, updateAnchorEntryDrag } from "./anchor-dnd";
import { setCssStyles } from "../../dom";
import { clampTimelineOffsetToBounds, resolveViewportHeight } from "../epoch-canvas/viewport-limits";
import type { DateEntry } from "../../indexer/types";

type MouseEventState = CanvasEventInternals & {
	animatingWheelZoom?: boolean;
	entryDragCandidateEntry?: DateEntry | null;
	entryDragCandidateGhostEntry?: DateEntry | null;
	entryDragCandidateStartX?: number;
	entryDragCandidateStartY?: number;
	mousePanButton?: number | null;
	__lastKnownCanvasCssHeight?: number;
	__ignoreHoverUntil?: number;
	__ignoreNextHoverMove?: boolean;
	__suppressHoverPointerX?: number;
	__suppressHoverPointerY?: number;
};

function getMouseState(canvas: EpochCanvas): MouseEventState {
	return getEventState(canvas);
}

function resolveToday(state: { getToday?: () => Date }): Date {
	try {
		if (typeof state.getToday === "function") return state.getToday();
	} catch {
		// ignore
	}
	return new Date();
}

export function handleMouseDown(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getMouseState(canvas);
	const isMiddleButton = event.button === 1;
	// Mobile: treat touch as the only interaction source.
	// This prevents synthetic mouse events from driving hover/drag behavior.
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	s.animatingView = false;
	s.animatingWheelZoom = false;
	if (event.button === 2) {
		event.preventDefault();
		try {
			const rect = s.canvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const entry = s.findSummaryEntryAtPoint(x, y);
			const day = entry ? null : s.findDayLayoutAtPoint(x, y);
			if (entry || day) {
				s.keepHoverUntilPointerMove = true;
				s.updateHover(x, y);
				s.lastPointerEvent = event;
			} else if (s.hoverSummary != null || s.hoverDateIndex != null) {
				s.keepHoverUntilPointerMove = true;
				s.lastPointerEvent = event;
			} else {
				s.keepHoverUntilPointerMove = false;
			}
		} catch {
			// ignore
		}
		return;
	}
	if (isMiddleButton) {
		event.preventDefault();
	}
	if (event.button !== 0 && !isMiddleButton) return;
	const now = window.performance.now();
	const motionActive = isViewMotionActive(s);
	if (motionActive || isWheelInteractionSuppressed(s, now)) {
		if (motionActive) {
			stopViewMotion(s);
			try {
				s.draw();
			} catch {
				// ignore
			}
		}
		try {
			const prev = Number(s.suppressClickUntil ?? 0);
			s.suppressClickUntil = Math.max(prev, now + 200);
		} catch {
			// ignore
		}
		try {
			event.preventDefault();
		} catch {
			// ignore
		}
		s.lastPointerEvent = event;
		s.entryDragCandidateEntry = null;
		s.entryDragCandidateGhostEntry = null;
		s.entryDragCandidateStartX = 0;
		s.entryDragCandidateStartY = 0;
		return;
	}

	s.pendingScrollNavHighlight = null;

	if (isMiddleButton) {
		s.entryDragCandidateEntry = null;
		s.entryDragCandidateGhostEntry = null;
	} else {
		try {
			const rect = s.canvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const entry = s.findSummaryEntryAtPoint(x, y);
			const dragEntry = resolveDraggableAnchorEntry(canvas, entry);
			if (dragEntry) {
				s.entryDragCandidateEntry = dragEntry;
				s.entryDragCandidateGhostEntry = entry;
				s.entryDragCandidateStartX = event.clientX;
				s.entryDragCandidateStartY = event.clientY;
			} else {
				s.entryDragCandidateEntry = null;
				s.entryDragCandidateGhostEntry = null;
			}
		} catch {
			s.entryDragCandidateEntry = null;
			s.entryDragCandidateGhostEntry = null;
		}
	}

	const hasEntryCandidate = !!s.entryDragCandidateEntry;
	if (!hasEntryCandidate) {
		s.animatingWheelPan = false;
		s.animatingWheelZoom = false;
		try {
			s.targetOffsetY = s.offsetY;
			s.targetScale = s.scale;
		} catch { void 0; }
		s.isDragging = true;
		s.dragSource = "mouse";
		s.mousePanButton = isMiddleButton ? 1 : 0;
		s.dragStartY = event.clientY;
		s.dragStartOffsetY = s.offsetY;
	}

	s.lastPanY = event.clientY;
	s.lastPanTime = now;
	s.velocityY = 0;

	s.mouseDownX = event.clientX;
	s.mouseDownY = event.clientY;
	s.mouseDownTime = now;
	s.mouseMoved = false;
	if (s.keepHoverUntilPointerMove) {
		s.keepHoverUntilPointerMove = false;
	}
}

export function handleMouseMove(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getMouseState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	if (s.entryDragActive) {
		updateAnchorEntryDrag(canvas, event.clientX, event.clientY);
		return;
	}
	const candidate = s.entryDragCandidateEntry;
	if (candidate && (event.buttons & 1)) {
		const sx = Number(s.entryDragCandidateStartX) || s.mouseDownX;
		const sy = Number(s.entryDragCandidateStartY) || s.mouseDownY;
		const distVal = Math.hypot(event.clientX - sx, event.clientY - sy);
		if (distVal > 6) {
			const ghost = s.entryDragCandidateGhostEntry ?? null;
			s.entryDragCandidateEntry = null;
			s.entryDragCandidateGhostEntry = null;
			s.entryDragCandidateStartX = 0;
			s.entryDragCandidateStartY = 0;
			resetScrollNavTargetState(canvas);
			s.mouseMoved = true;
			beginAnchorEntryDrag(canvas, candidate, "mouse", sx, sy, ghost);
			updateAnchorEntryDrag(canvas, event.clientX, event.clientY);
			return;
		}
	}

	if (!s.isDragging) return;
	// Treat active drag as an "animating" period for perf gating.
	s.viewInteractionUntil = window.performance.now() + 140;
	const now = window.performance.now();
	const dy = event.clientY - s.dragStartY;
	s.offsetY = s.dragStartOffsetY + dy;
	const viewportHeight = resolveViewportHeight(s.root, Number(s.__lastKnownCanvasCssHeight ?? 0));
	if (viewportHeight > 0) {
		s.offsetY = clampTimelineOffsetToBounds({
			offsetY: s.offsetY,
			scale: s.scale,
			viewportHeight,
			today: resolveToday(s)
		});
	}
	if (dy !== 0) {
		try {
			setCssStyles(s.canvas, { cursor: "grabbing" });
		} catch {
			// ignore
		}
	}

	const dt = now - s.lastPanTime;
	if (dt > 0) {
		const dyStep = event.clientY - s.lastPanY;
		if (s.dragSource === "touch") {
			s.velocityY = dyStep / dt;
		} else {
			s.velocityY = 0;
		}
		s.lastPanY = event.clientY;
		s.lastPanTime = now;
	}

	const distVal = Math.hypot(
		event.clientX - s.mouseDownX,
		event.clientY - s.mouseDownY
	);
	if (distVal > 12 && !s.mouseMoved) {
		s.mouseMoved = true;
		resetScrollNavTargetState(canvas);
		// Once we've committed to a drag gesture, do not allow hover to reappear
		// under the pointer as the view pans.
		s.clearHover();
	}

	s.draw();
}

export function handleMouseUp(canvas: EpochCanvas): void {
	const s = getMouseState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	if (s.entryDragActive) {
		void commitAnchorEntryDrag(canvas);
		return;
	}
	s.entryDragCandidateEntry = null;
	s.entryDragCandidateGhostEntry = null;
	s.entryDragCandidateStartX = 0;
	s.entryDragCandidateStartY = 0;
	if (!s.isDragging) return;
	s.isDragging = false;
	s.dragSource = null;
	s.velocityY = 0;
	s.mousePanButton = null;
	try {
		setCssStyles(s.canvas, { cursor: "" });
	} catch {
		// ignore
	}
	// If this interaction was a drag (not a click), keep hover cleared and suppress
	// hover briefly so leaving the canvas doesn't flicker hover on/off.
	if (s.mouseMoved) {
		s.clearHover();
		s.suppressHoverUntil = window.performance.now() + 120;
	}
}

export function handleHoverMouse(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getMouseState(canvas);
	// Mobile: no hover driven by mousemove; touchstart is the only hover entry.
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	// Never update hover while a primary interaction is active.
	// This prevents hover flicker when click-dragging (mouse pan) and then leaving the canvas.
	if (s.isDragging || (event.buttons & 1) || (event.buttons & 4)) {
		s.lastPointerEvent = event;
		return;
	}
	// Some platforms emit synthetic mouse events after touch interactions.
	// Do not let those events drive hover state; touch hover is handled in touchstart.
	try {
		const sourceCapsUnknown: unknown = (event as MouseEvent & { sourceCapabilities?: unknown }).sourceCapabilities;
		const firesTouchEvents =
			!!sourceCapsUnknown &&
			typeof sourceCapsUnknown === "object" &&
			(sourceCapsUnknown as { firesTouchEvents?: unknown }).firesTouchEvents === true;
		if (firesTouchEvents) {
			s.lastPointerEvent = event;
			return;
		}
	} catch {
		// ignore
	}
	const now = window.performance.now();
	// After touch/two-finger scroll-nav, some platforms emit a stray mousemove that would
	// otherwise clear/reposition the programmatic hover, causing a visible "jump".
	try {
		const ignoreUntil = Number(s.__ignoreHoverUntil ?? 0);
		if (Number.isFinite(ignoreUntil) && ignoreUntil > 0 && now < ignoreUntil) {
			s.lastPointerEvent = event;
			return;
		}
		if (s.__ignoreNextHoverMove) {
			s.__ignoreNextHoverMove = false;
			s.lastPointerEvent = event;
			return;
		}
	} catch {
		// ignore
	}
	// During Alt+wheel / Alt+arrow scroll navigation, some platforms emit incidental mousemove
	// events while the view is animating. Do not let those pointer updates clear the
	// programmatic scroll-nav hover.
	if (s.previewLockedUntilAltRelease) {
		s.lastPointerEvent = event;
		return;
	}
	if (Number.isFinite(s.suppressHoverUntil) && now < s.suppressHoverUntil) {
		s.lastPointerEvent = event;
		return;
	}
	if (s.suppressHoverUntilPointerMove) {
		// Only re-enable hover once the user has actually moved the pointer.
		// Some platforms emit stray mousemove events after touch/two-finger gestures.
		try {
			const sxRaw = s.__suppressHoverPointerX;
			const syRaw = s.__suppressHoverPointerY;
			const sx = Number(sxRaw);
			const sy = Number(syRaw);
			if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
				s.__suppressHoverPointerX = event.clientX;
				s.__suppressHoverPointerY = event.clientY;
				s.lastPointerEvent = event;
				return;
			}
			const moved = Math.hypot(event.clientX - sx, event.clientY - sy) > 2;
			if (!moved) {
				s.lastPointerEvent = event;
				return;
			}
		} catch {
			// ignore
		}
		s.suppressHoverUntilPointerMove = false;
		try {
			s.__suppressHoverPointerX = event.clientX;
			s.__suppressHoverPointerY = event.clientY;
		} catch {
			// ignore
		}
	}
	if (s.keepHoverUntilPointerMove && (event.buttons & 2)) {
		s.lastPointerEvent = event;
		return;
	}
	const rect = s.canvas.getBoundingClientRect();
	s.keepHoverUntilPointerMove = false;
	const localX = event.clientX - rect.left;
	const localY = event.clientY - rect.top;
	s.updateHover(localX, localY);
	s.lastPointerEvent = event;
	s.attemptHoverPreview(event);
}
