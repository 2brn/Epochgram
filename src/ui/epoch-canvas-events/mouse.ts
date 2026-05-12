import type { EpochCanvas } from "../epoch-canvas";
import { resetScrollNavTargetState } from "../epoch-canvas/scroll-nav-reset";
import { getEventState, isViewMotionActive, isWheelInteractionSuppressed, stopViewMotion } from "./state";
import { beginAnchorEntryDrag, commitAnchorEntryDrag, resolveDraggableAnchorEntry, updateAnchorEntryDrag } from "./anchor-dnd";
import { setCssStyles } from "../../dom";

export function handleMouseDown(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getEventState(canvas);
	const isMiddleButton = event.button === 1;
	// Mobile: treat touch as the only interaction source.
	// This prevents synthetic mouse events from driving hover/drag behavior.
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	s.animatingView = false;
	(s as any).animatingWheelZoom = false;
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
	const now = performance.now();
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
			const prev = Number((s as any).suppressClickUntil ?? 0);
			(s as any).suppressClickUntil = Math.max(prev, now + 200);
		} catch {
			// ignore
		}
		try {
			event.preventDefault();
		} catch {
			// ignore
		}
		s.lastPointerEvent = event;
		(s as any).entryDragCandidateEntry = null;
		(s as any).entryDragCandidateGhostEntry = null;
		(s as any).entryDragCandidateStartX = 0;
		(s as any).entryDragCandidateStartY = 0;
		return;
	}

	s.pendingScrollNavHighlight = null;

	if (isMiddleButton) {
		(s as any).entryDragCandidateEntry = null;
		(s as any).entryDragCandidateGhostEntry = null;
	} else {
		try {
			const rect = s.canvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const entry = s.findSummaryEntryAtPoint(x, y);
			const dragEntry = resolveDraggableAnchorEntry(canvas, entry);
			if (dragEntry) {
				(s as any).entryDragCandidateEntry = dragEntry;
				(s as any).entryDragCandidateGhostEntry = entry;
				(s as any).entryDragCandidateStartX = event.clientX;
				(s as any).entryDragCandidateStartY = event.clientY;
			} else {
				(s as any).entryDragCandidateEntry = null;
				(s as any).entryDragCandidateGhostEntry = null;
			}
		} catch {
			(s as any).entryDragCandidateEntry = null;
			(s as any).entryDragCandidateGhostEntry = null;
		}
	}

	const hasEntryCandidate = !!(s as any).entryDragCandidateEntry;
	if (!hasEntryCandidate) {
		(s as any).animatingWheelPan = false;
		(s as any).animatingWheelZoom = false;
		try {
			s.targetOffsetY = s.offsetY;
			s.targetScale = s.scale;
		} catch {}
		s.isDragging = true;
		s.dragSource = "mouse";
		(s as any).mousePanButton = isMiddleButton ? 1 : 0;
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
	const s = getEventState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	const anyS: any = s as any;
	if (anyS.entryDragActive) {
		updateAnchorEntryDrag(canvas, event.clientX, event.clientY);
		return;
	}
	const candidate = anyS.entryDragCandidateEntry as any;
	if (candidate && (event.buttons & 1)) {
		const sx = Number(anyS.entryDragCandidateStartX) || s.mouseDownX;
		const sy = Number(anyS.entryDragCandidateStartY) || s.mouseDownY;
		const distVal = Math.hypot(event.clientX - sx, event.clientY - sy);
		if (distVal > 6) {
			const ghost = anyS.entryDragCandidateGhostEntry as any;
			anyS.entryDragCandidateEntry = null;
			anyS.entryDragCandidateGhostEntry = null;
			anyS.entryDragCandidateStartX = 0;
			anyS.entryDragCandidateStartY = 0;
			resetScrollNavTargetState(canvas);
			s.mouseMoved = true;
			beginAnchorEntryDrag(canvas, candidate, "mouse", sx, sy, ghost);
			updateAnchorEntryDrag(canvas, event.clientX, event.clientY);
			return;
		}
	}

	if (!s.isDragging) return;
	// Treat active drag as an "animating" period for perf gating.
	s.viewInteractionUntil = performance.now() + 140;
	const now = performance.now();
	const dy = event.clientY - s.dragStartY;
	s.offsetY = s.dragStartOffsetY + dy;
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
	const s = getEventState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	const anyS: any = s as any;
	if (anyS.entryDragActive) {
		void commitAnchorEntryDrag(canvas);
		return;
	}
	anyS.entryDragCandidateEntry = null;
	anyS.entryDragCandidateGhostEntry = null;
	anyS.entryDragCandidateStartX = 0;
	anyS.entryDragCandidateStartY = 0;
	if (!s.isDragging) return;
	s.isDragging = false;
	s.dragSource = null;
	s.velocityY = 0;
	(s as any).mousePanButton = null;
	try {
		setCssStyles(s.canvas, { cursor: "" });
	} catch {
		// ignore
	}
	// If this interaction was a drag (not a click), keep hover cleared and suppress
	// hover briefly so leaving the canvas doesn't flicker hover on/off.
	if (s.mouseMoved) {
		s.clearHover();
		s.suppressHoverUntil = performance.now() + 120;
	}
}

export function handleHoverMouse(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getEventState(canvas);
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
		if ((event as any)?.sourceCapabilities?.firesTouchEvents) {
			s.lastPointerEvent = event;
			return;
		}
	} catch {
		// ignore
	}
	const now = performance.now();
	// After touch/two-finger scroll-nav, some platforms emit a stray mousemove that would
	// otherwise clear/reposition the programmatic hover, causing a visible "jump".
	try {
		const ignoreUntil = Number((s as any).__ignoreHoverUntil ?? 0);
		if (Number.isFinite(ignoreUntil) && ignoreUntil > 0 && now < ignoreUntil) {
			s.lastPointerEvent = event;
			return;
		}
		if ((s as any).__ignoreNextHoverMove) {
			(s as any).__ignoreNextHoverMove = false;
			s.lastPointerEvent = event;
			return;
		}
	} catch {
		// ignore
	}
	// During Alt+wheel / Alt+arrow scroll navigation, some platforms emit incidental mousemove
	// events while the view is animating. Do not let those pointer updates clear the
	// programmatic scroll-nav hover.
	if ((s as any).previewLockedUntilAltRelease) {
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
			const sxRaw = (s as any).__suppressHoverPointerX;
			const syRaw = (s as any).__suppressHoverPointerY;
			const sx = Number(sxRaw);
			const sy = Number(syRaw);
			if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
				(s as any).__suppressHoverPointerX = event.clientX;
				(s as any).__suppressHoverPointerY = event.clientY;
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
			(s as any).__suppressHoverPointerX = event.clientX;
			(s as any).__suppressHoverPointerY = event.clientY;
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
