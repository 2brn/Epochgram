import type { EpochCanvas } from "../epoch-canvas";
import { Platform } from "obsidian";
import { dist, mid } from "../epoch-canvas-utils";
import { hideHoverPreview as hideHoverPreviewHelper } from "../epoch-canvas-hover";
import {
	LONG_PRESS_MS,
	LONG_PRESS_TOGGLE_VIEW_MS,
	MIN_SCALE,
	MAX_SCALE,
	INERTIA_BOOST,
	DATE_TOUCH_HIT_PAD,
	DOUBLE_TAP_MAX_DELAY,
	DOUBLE_TAP_MAX_DIST,
	TAP_MAX_DURATION
} from "../epoch-canvas-constants";
import { resetScrollNavTargetState } from "../epoch-canvas/scroll-nav-reset";
import { getEventState, isViewMotionActive, stopViewMotion } from "./state";
import { handleDoublePoint, handlePointClick } from "./interactions";
import {
	beginAnchorEntryDrag,
	cancelAnchorEntryDrag,
	commitAnchorEntryDrag,
	resolveDraggableAnchorEntry,
	updateAnchorEntryDrag
} from "./anchor-dnd";
import { clampTimelineOffsetToBounds, resolveViewportHeight } from "../epoch-canvas/viewport-limits";

function resolveToday(state: any): Date {
	try {
		if (typeof state?.getToday === "function") return state.getToday();
	} catch {
		// ignore
	}
	return new Date();
}

function suppressIncidentalHoverAfterTouch(state: any, durationMs: number = 450): void {
	try {
		if (typeof state?.isPointerDeviceEvent === "function" && state.isPointerDeviceEvent()) return;
		const now = performance.now();
		state.suppressHoverUntil = Math.max(Number(state.suppressHoverUntil ?? 0) || 0, now + 220);
		state.suppressHoverUntilPointerMove = true;
		state.__ignoreNextHoverMove = true;
		state.__ignoreHoverUntil = now + durationMs;
	} catch {
		// ignore
	}
}

function findTouchDayLayoutAtPoint(s: any, x: number, y: number): any {
	const pad = Number(DATE_TOUCH_HIT_PAD) || 0;
	const list: any[] = Array.isArray(s?.layouts) ? s.layouts : [];
	for (let i = 0; i < list.length; i++) {
		const day = list[i];
		if (!day || day.hasVisibleDate !== true) continue;
		const r = day.dateRect;
		if (!r) continue;
		if (x >= r.x1 - pad && x <= r.x2 + pad && y >= r.y1 - pad && y <= r.y2 + pad) {
			return day;
		}
	}
	return null;
}

function findTouchSummaryEntryAtPoint(s: any, x: number, y: number): any {
	const list: any[] = Array.isArray(s?.layouts) ? s.layouts : [];
	for (let i = 0; i < list.length; i++) {
		const day = list[i];
		const rects: any[] =
			(Array.isArray(day?.summaryHoverRects) && day.summaryHoverRects.length > 0)
				? day.summaryHoverRects
				: (Array.isArray(day?.summaryRects) ? day.summaryRects : []);
		for (let j = 0; j < rects.length; j++) {
			const r = rects[j];
			if (!r) continue;
			if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
				return r.entry ?? null;
			}
		}
	}
	return null;
}

function clearPendingDateTapOpen(s: any): void {
	try {
		const id = Number((s as any).__touchPendingDateTapTimeoutId);
		if (Number.isFinite(id) && id > 0) {
			clearTimeout(id);
		}
	} catch {
		// ignore
	}
	try {
		(s as any).__touchPendingDateTapTimeoutId = null;
		(s as any).__touchPendingDateTapX = null;
		(s as any).__touchPendingDateTapY = null;
		(s as any).__touchPendingDateTapAt = null;
	} catch {
		// ignore
	}
}

function scheduleDeferredDateTapOpen(canvas: EpochCanvas, s: any, x: number, y: number): void {
	clearPendingDateTapOpen(s);
	try {
		(s as any).__touchPendingDateTapX = x;
		(s as any).__touchPendingDateTapY = y;
		(s as any).__touchPendingDateTapAt = Date.now();
	} catch {
		// ignore
	}

	const delay = Math.max(0, Number(DOUBLE_TAP_MAX_DELAY) || 0) + 10;
	const token = (Number((s as any).__touchPendingDateTapToken) || 0) + 1;
	try {
		(s as any).__touchPendingDateTapToken = token;
	} catch {
		// ignore
	}

	try {
		(s as any).__touchPendingDateTapTimeoutId = setTimeout(() => {
			try {
				const st: any = getEventState(canvas) as any;
				if (Number(st.__touchPendingDateTapToken) !== token) return;
				const consumeToken = Number((st as any).__touchConsumeActionsToken ?? 0) || 0;
				const activeToken = Number((st as any).__touchGestureActiveToken ?? 0) || 0;
				if (isViewMotionActive(st) || (consumeToken > 0 && activeToken > 0 && consumeToken === activeToken)) {
					clearPendingDateTapOpen(st);
					return;
				}
				clearPendingDateTapOpen(st);
				void handlePointClick(canvas, x, y, false, false, { preserveHoverOnNonPointer: true });
			} catch {
				// ignore
			}
		}, delay);
	} catch {
		// ignore
	}
}

export function handleTouchStart(canvas: EpochCanvas, event: TouchEvent): void {
	const s = getEventState(canvas);
	event.preventDefault();
	const gestureToken = (Number((s as any).__touchGestureToken) || 0) + 1;
	try {
		(s as any).__touchGestureToken = gestureToken;
		(s as any).__touchGestureActiveToken = gestureToken;
	} catch {
		// ignore
	}
	const nowPerf = performance.now();
	const wasMoving = event.touches.length === 1 && isViewMotionActive(s);
	try {
		(s as any).__touchGestureStartedDuringMotion = wasMoving;
		(s as any).__touchCarryVelocity = wasMoving ? Number(s.velocityY) || 0 : 0;
	} catch {
		// ignore
	}
	if (wasMoving) {
		try {
			(s as any).__touchConsumeActionsToken = gestureToken;
		} catch {
			// ignore
		}
		try {
			stopViewMotion(s);
		} catch {
			// ignore
		}
		try {
			const prev = Number((s as any).suppressClickUntil ?? 0);
			(s as any).suppressClickUntil = Math.max(prev, nowPerf + 260);
		} catch {
			// ignore
		}
		clearPendingDateTapOpen(s);
		try {
			(s as any).__touchHoverDelayCancelled = true;
		} catch {
			// ignore
		}
		try {
			s.keepHoverUntilPointerMove = false;
			s.clearHover(true);
		} catch {
			// ignore
		}
		try {
			suppressIncidentalHoverAfterTouch(s, 650);
		} catch {
			// ignore
		}
	}
	try {
		(s as any).__touchEntryDragArmed = null;
		(s as any).__touchEntryDragMenu = null;
	} catch {
		// ignore
	}
	try {
		const prev = Number((s as any).__touchHoverDelayTimerId);
		if (Number.isFinite(prev) && prev > 0) {
			clearTimeout(prev);
		}
	} catch {
		// ignore
	}
	(s as any).__touchHoverDelayTimerId = null;
	(s as any).__touchHoverDelayCancelled = false;
	// Touch interactions generally override any in-flight view animation, but two-finger tap
	// scroll navigation should behave like Alt+Wheel / Alt+UpDown and not cancel animation.
	if (event.touches.length !== 2) {
		s.animatingView = false;
		(s as any).animatingWheelZoom = false;
	}
	if (s.epochsView) {
		s.touchHadMultipleTouches = event.touches.length > 1;
	}

	if (s.keepHoverAfterMenu) {
		s.keepHoverAfterMenu = false;
		s.clearHover(true);
	}

	if (event.touches.length > 1) {
		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
			s.touchLongPressTimeout = null;
		}
	}

	if (event.touches.length === 1) {
		const touch = event.touches[0];
		(s as any)._swipeHideTriggered = false;
		(s as any).__touchSwipeHideLock = false;

		s.pendingScrollNavHighlight = null;
		s.touchHadMultipleTouches = false;

		s.touchMode = null;
		s.touchStartX = touch.clientX;
		s.touchStartY = touch.clientY;
		s.touchStartOffsetY = s.offsetY;
		s.touchStartTime = Date.now();
		s.touchMoved = false;

		s.lastPanY = touch.clientY;
		s.lastPanTime = performance.now();
		s.velocityY = 0;

		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
		}
		const rect0 = s.canvas.getBoundingClientRect();
		const x0 = s.touchStartX - rect0.left;
		const y0 = s.touchStartY - rect0.top;
		// If a date tap is pending, a second tap near the same point should cancel it
		// so double-tap can take over (create another daily) without a late open.
		try {
			const pendingId = Number((s as any).__touchPendingDateTapTimeoutId);
			if (Number.isFinite(pendingId) && pendingId > 0) {
				const px = Number((s as any).__touchPendingDateTapX);
				const py = Number((s as any).__touchPendingDateTapY);
				const at = Number((s as any).__touchPendingDateTapAt);
				const dt = at > 0 ? (Date.now() - at) : Infinity;
				const d = Number.isFinite(px) && Number.isFinite(py) ? Math.hypot(x0 - px, y0 - py) : Infinity;
				if (dt < DOUBLE_TAP_MAX_DELAY && d < DOUBLE_TAP_MAX_DIST) {
					clearPendingDateTapOpen(s);
				}
			}
		} catch {
			// ignore
		}
		try {
			const entry0 = findTouchSummaryEntryAtPoint(s, x0, y0) ?? s.findSummaryEntryAtPoint(x0, y0);
			(s as any).__touchDragAnchorEntry = resolveDraggableAnchorEntry(canvas, entry0);
			(s as any).__touchDragGhostEntry = entry0 ?? null;
		} catch {
			(s as any).__touchDragAnchorEntry = null;
			(s as any).__touchDragGhostEntry = null;
		}
		// Touch devices have no true hover. For tap interactions, show the hover state
		// immediately on finger-down so the user gets instant feedback. Keep it anchored
		// to the initial touch point (do not continuously move hover with small finger drift).
		try {
			const hasHoverTarget = !!findTouchSummaryEntryAtPoint(s, x0, y0) || !!findTouchDayLayoutAtPoint(s, x0, y0);
			if (hasHoverTarget) {
				// Touch panning should not flash hover. Delay hover very briefly; if the
				// gesture crosses the pan threshold, touchmove cancels this timer.
				(s as any).__touchHoverDelayCancelled = false;
				const token = (Number((s as any).__touchHoverDelayToken) || 0) + 1;
				(s as any).__touchHoverDelayToken = token;
				const HOVER_DELAY_MS = 50;
				(s as any).__touchHoverDelayTimerId = setTimeout(() => {
					try {
						const st: any = getEventState(canvas) as any;
						if (Number(st.__touchHoverDelayToken) !== token) return;
						if (st.__touchHoverDelayCancelled === true) return;
						if (st.touchMode === "pan" || st.touchMode === "pinch" || st.touchMode === "twofinger") return;
						const consumeToken = Number((st as any).__touchConsumeActionsToken ?? 0) || 0;
						const activeToken = Number((st as any).__touchGestureActiveToken ?? 0) || 0;
						if (isViewMotionActive(st) || (consumeToken > 0 && activeToken > 0 && consumeToken === activeToken)) return;
						// If a prior gesture suppressed hover, a direct touch should still be allowed
						// to establish a target under the finger.
						st.suppressHoverUntilPointerMove = false;
						st.suppressHoverUntil = 0;
						st.updateHover(x0, y0);
						// Keep this touch-established hover stable through quick finger-up.
						st.keepHoverUntilPointerMove = true;
						try {
							st.__touchHoverPinnedUntil = performance.now() + 220;
						} catch {
							// ignore
						}
					} catch {
						// ignore
					}
				}, HOVER_DELAY_MS);
			} else {
				// Touching empty space counts as an interaction; clear any prior hover (e.g.,
				// from scroll-nav) so it doesn't linger during pan/gesture.
				s.keepHoverUntilPointerMove = false;
				s.clearHover(true);
			}
		} catch {
			// ignore
		}
		const longPressDelay =
			findTouchSummaryEntryAtPoint(s, x0, y0) || findTouchDayLayoutAtPoint(s, x0, y0)
				? LONG_PRESS_MS
				: LONG_PRESS_TOGGLE_VIEW_MS;

		s.touchLongPressTimeout = setTimeout(() => {
			try {
				const st: any = getEventState(canvas) as any;
				const consumeToken = Number((st as any).__touchConsumeActionsToken ?? 0) || 0;
				const activeToken = Number((st as any).__touchGestureActiveToken ?? 0) || 0;
				if (isViewMotionActive(st) || (consumeToken > 0 && activeToken > 0 && consumeToken === activeToken)) {
					return;
				}
			} catch {
				// ignore
			}
			const rect = s.canvas.getBoundingClientRect();
			const x = s.touchStartX - rect.left;
			const y = s.touchStartY - rect.top;
			const dragEntry = (() => {
				try {
					const cached = (s as any).__touchDragAnchorEntry;
					if (cached) return cached;
				} catch {
					// ignore
				}
				try {
					const hit = findTouchSummaryEntryAtPoint(s, x, y) ?? s.findSummaryEntryAtPoint(x, y);
					return resolveDraggableAnchorEntry(canvas, hit);
				} catch {
					return null;
				}
			})();
			const entry = findTouchSummaryEntryAtPoint(s, x, y) ?? s.findSummaryEntryAtPoint(x, y);
			if (entry) {
				s.keepHoverAfterMenu = true;
				s.touchMode = null;
				try {
					(s as any).__touchEntryDragArmed = null;
					(s as any).__touchEntryDragMenu = null;
				} catch {
					// ignore
				}
				// If a prior gesture temporarily suppressed hover, still allow
				// a long-press to lock the target under the finger before opening menus.
				try {
					s.suppressHoverUntilPointerMove = false;
					s.suppressHoverUntil = 0;
				} catch {
					// ignore
				}
				s.updateHover(x, y);
				const menu = s.showSummaryMenu(entry, s.touchStartX, s.touchStartY);
				if (dragEntry) {
					const ghostEntry = (() => {
						try {
							return (s as any).__touchDragGhostEntry ?? null;
						} catch {
							return null;
						}
					})();
					try {
						(s as any).__touchEntryDragArmed = { entry: dragEntry, ghostEntry };
						(s as any).__touchEntryDragMenu = menu as any;
					} catch {
						// ignore
					}
					try {
						(s as any).__touchHoverDelayCancelled = true;
					} catch {
						// ignore
					}
				}
				suppressIncidentalHoverAfterTouch(s, 650);
				return;
			}
			const day = findTouchDayLayoutAtPoint(s, x, y);
			if (day) {
				s.keepHoverAfterMenu = true;
				s.touchMode = null;
				try {
					s.suppressHoverUntilPointerMove = false;
					s.suppressHoverUntil = 0;
				} catch {
					// ignore
				}
				s.updateHover(x, y);
				s.showDateMenu(day.index, s.touchStartX, s.touchStartY);
				try {
					(s as any).__touchEntryDragArmed = null;
					(s as any).__touchEntryDragMenu = null;
				} catch {
					// ignore
				}
				suppressIncidentalHoverAfterTouch(s, 650);
				return;
			}
			s.keepHoverAfterMenu = false;
			s.touchMode = null;
			try {
				(s as any).__touchEntryDragArmed = null;
				(s as any).__touchEntryDragMenu = null;
			} catch {
				// ignore
			}
			s.toggleEmptyAreaView();
		}, longPressDelay) as unknown as number;
	} else if (event.touches.length === 2) {
		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
			s.touchLongPressTimeout = null;
		}

		const t1 = event.touches.item(0);
		const t2 = event.touches.item(1);
		if (!t1 || !t2) return;
		s.touchHadMultipleTouches = true;
		s.touchMode = "twofinger";
		s.pinchStartDist = dist(t1, t2);
		s.pinchStartScale = s.scale;

		const rect = s.canvas.getBoundingClientRect();
		const midpoint = mid(t1, t2);
		const midY = midpoint.y - rect.top;
		s.pinchAnchorWorldY = (midY - s.offsetY) / s.scale;
		s.twoFingerStartTime = Date.now();
		s.twoFingerAnchorX = midpoint.x;
		s.twoFingerAnchorY = midpoint.y;
		s.twoFingerMoved = false;
		s.touchMoved = false;
		s.touchStartTime = Date.now();
	}
}

export function handleTouchMove(canvas: EpochCanvas, event: TouchEvent): void {
	const s = getEventState(canvas);
	event.preventDefault();
	const perfNow = performance.now();

	if (event.touches.length === 2) {
		// Two-finger gestures are always high-frequency and should engage perf gating.
		s.viewInteractionUntil = perfNow + 140;
		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
			s.touchLongPressTimeout = null;
		}
		const t1 = event.touches.item(0);
		const t2 = event.touches.item(1);
		if (!t1 || !t2) return;
		const rect = s.canvas.getBoundingClientRect();
		const midpoint = mid(t1, t2);
		const midY = midpoint.y - rect.top;
		const newDist = dist(t1, t2);
		const distDelta = Math.abs(newDist - s.pinchStartDist);
		const moveDelta = Math.hypot(midpoint.x - s.twoFingerAnchorX, midpoint.y - s.twoFingerAnchorY);
		if (s.touchMode === "twofinger") {
			if (distDelta > 8 || moveDelta > 12) {
				s.touchMode = "pinch";
			} else if (distDelta > 2 || moveDelta > 6) {
				s.twoFingerMoved = true;
			}
		}
		if (s.touchMode !== "pinch") {
			return;
		}

		// Pinch zoom should override any in-flight view animation.
		s.animatingView = false;

		// Pinch zoom should not trigger/adjust hover.
		const now = performance.now();
		s.suppressHoverUntil = now + 180;
		s.suppressHoverUntilPointerMove = true;
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
		(s as any).hoverAnim = 0;
		(s as any).hoverEaseStartAt = null;
		(s as any).hoverEaseFrom = 0;
		(s as any).hoverEaseTo = 0;
		(s as any).outgoingSummaries = [];
		(s as any).outgoingDates = [];

		let newScale = s.pinchStartScale * (newDist / s.pinchStartDist);
		newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

		s.touchMode = "pinch";
		s.touchMoved = true;
		s.scale = newScale;
		s.offsetY = midY - s.pinchAnchorWorldY * s.scale;
		const viewportHeight = resolveViewportHeight(s.root, Number((s as any).__lastKnownCanvasCssHeight ?? 0));
		if (viewportHeight > 0) {
			s.offsetY = clampTimelineOffsetToBounds({
				offsetY: s.offsetY,
				scale: s.scale,
				viewportHeight,
				today: resolveToday(s)
			});
		}
		s.draw();
		return;
	}

	if (event.touches.length !== 1) return;

	const touch = event.touches[0];

	try {
		const isMobileSurface = Platform.isMobileApp || Platform.isMobile === true;
		const plugin = (canvas as any).plugin;
		if (plugin && typeof plugin === "object" && plugin.app?.workspace && isMobileSurface && (s as any).__touchGestureStartedDuringMotion !== true) {
			const dx = touch.clientX - s.touchStartX;
			const dy = touch.clientY - s.touchStartY;
			console.debug("Touch move", { dx, dy});	
			if (!(s as any)._swipeHideTriggered && dx > 30 && dx > Math.abs(dy) * 2) {
				(s as any)._swipeHideTriggered = true;
				(s as any).__touchSwipeHideLock = true;
				s.touchMode = "swipehide" as any;
				s.touchMoved = true;
				s.dragSource = null;
				if (s.touchLongPressTimeout != null) {
					clearTimeout(s.touchLongPressTimeout);
					s.touchLongPressTimeout = null;
				}
				stopViewMotion(s);
				try {
					if (typeof plugin.app.workspace.detachLeavesOfType === "function") {
						plugin.app.workspace.rightSplit.collapse();
					}
				} catch {
					// ignore
				}
				return;
			}
		}
	} catch {}
	if ((s as any).__touchSwipeHideLock === true) {
		return;
	}
	if (s.touchMode === "entrydrag" || (s as any).entryDragActive) {
		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
			s.touchLongPressTimeout = null;
		}
		updateAnchorEntryDrag(canvas, touch.clientX, touch.clientY);
		return;
	}
	try {
		const armed = (s as any).__touchEntryDragArmed as any;
		if (armed && armed.entry) {
			const dx = touch.clientX - s.touchStartX;
			const dy = touch.clientY - s.touchStartY;
			const distVal = Math.hypot(dx, dy);
			if (distVal > 12) {
				if (s.touchLongPressTimeout != null) {
					clearTimeout(s.touchLongPressTimeout);
					s.touchLongPressTimeout = null;
				}
				try {
					const menu = (s as any).__touchEntryDragMenu as any;
					menu?.hide?.();
					menu?.close?.();
				} catch {
					// ignore
				}
				try {
					(s as any).__touchEntryDragMenu = null;
					(s as any).__touchEntryDragArmed = null;
				} catch {
					// ignore
				}
				s.keepHoverAfterMenu = false;
				s.keepHoverUntilPointerMove = false;
				s.clearHover(true);
				s.touchMoved = true;
				s.touchMode = "entrydrag" as any;
				beginAnchorEntryDrag(canvas, armed.entry, "touch", touch.clientX, touch.clientY, armed.ghostEntry ?? null);
				updateAnchorEntryDrag(canvas, touch.clientX, touch.clientY);
				suppressIncidentalHoverAfterTouch(s, 650);
				return;
			}
		}
	} catch {
		// ignore
	}
	if (s.touchMode === "twofinger") {
		return;
	}
	const dx = touch.clientX - s.touchStartX;
	const dy = touch.clientY - s.touchStartY;
	const distVal = Math.hypot(dx, dy);

	if (!s.touchMoved && distVal > 12) {
		(s as any)._swipeHideTriggered = false;
		// Pan start: engage perf gating.
		s.viewInteractionUntil = perfNow + 140;
		s.touchMoved = true;
		clearPendingDateTapOpen(s);
		try {
			const consumeToken = Number((s as any).__touchConsumeActionsToken ?? 0) || 0;
			const activeToken = Number((s as any).__touchGestureActiveToken ?? 0) || 0;
			if (consumeToken > 0 && activeToken > 0 && consumeToken === activeToken) {
				(s as any).__touchConsumeActionsToken = 0;
			}
		} catch {
			// ignore
		}
		try {
			(s as any).__touchHoverDelayCancelled = true;
			const t = Number((s as any).__touchHoverDelayTimerId);
			if (Number.isFinite(t) && t > 0) {
				clearTimeout(t);
			}
		} catch {
			// ignore
		}
		(s as any).__touchHoverDelayTimerId = null;
		resetScrollNavTargetState(canvas);
		if (s.touchLongPressTimeout != null) {
			clearTimeout(s.touchLongPressTimeout);
			s.touchLongPressTimeout = null;
		}
		// Once the finger moves beyond the tap threshold, treat this as a pan.
		s.touchMode = "pan";
		s.dragSource = "touch";
		try {
			(s as any).__touchPanStartedAt = performance.now();
			(s as any).__touchPanAbs = 0;
			const carryVelocity = Number((s as any).__touchCarryVelocity ?? 0) || 0;
			s.velocityY = carryVelocity;
		} catch {
			// ignore
		}
		s.lastPanY = touch.clientY;
		s.lastPanTime = performance.now();
		// Touch-drag is for panning; it should not trigger/adjust hover.
		// Force-clear so persistent scroll-nav date hover is cleared too.
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
		suppressIncidentalHoverAfterTouch(s);
		s.touchStartY = touch.clientY;
		s.touchStartOffsetY = s.offsetY;
	}

	if (s.touchMode === "pan") {
		// Active panning: engage perf gating.
		s.viewInteractionUntil = perfNow + 140;
		const dyPan = touch.clientY - s.touchStartY;
		s.offsetY = s.touchStartOffsetY + dyPan;
		const viewportHeight = resolveViewportHeight(s.root, Number((s as any).__lastKnownCanvasCssHeight ?? 0));
		if (viewportHeight > 0) {
			s.offsetY = clampTimelineOffsetToBounds({
				offsetY: s.offsetY,
				scale: s.scale,
				viewportHeight,
				today: resolveToday(s)
			});
		}

		const now = performance.now();
		const dt = now - s.lastPanTime;
		if (dt > 0) {
			const dyStep = touch.clientY - s.lastPanY;
			const carryVelocity = Number((s as any).__touchCarryVelocity ?? 0) || 0;
			const carryBlend = 1 / Math.max(1, Number(INERTIA_BOOST) || 1);
			s.velocityY = (dyStep / dt) + (carryVelocity * carryBlend);
			(s as any).__touchCarryVelocity = 0;
			try {
				const prevAbs = Number((s as any).__touchPanAbs ?? 0) || 0;
				(s as any).__touchPanAbs = prevAbs + Math.abs(dyStep);
			} catch {
				// ignore
			}
			s.lastPanY = touch.clientY;
			s.lastPanTime = now;
		}

		s.draw();
	} else if (s.touchMode === "hover") {
		// Hover mode is light; do not treat as view interaction.
		const rect = s.canvas.getBoundingClientRect();
		s.updateHover(touch.clientX - rect.left, touch.clientY - rect.top);
	}
}

export async function handleTouchEnd(canvas: EpochCanvas, event: TouchEvent): Promise<void> {
	const s = getEventState(canvas);
	// Some Android/Obsidian touch stacks can emit a quick touchend followed by a touchcancel
	// (or vice versa). De-dupe those to avoid hover clearing/reapplying (visible "jump").
	try {
		const now = performance.now();
		const last = Number((s as any).__lastTouchEndLikeAt ?? 0) || 0;
		if (last > 0 && now - last < 60 && event.touches.length === 0) {
			s.dragSource = null;
			s.touchMode = null;
			suppressIncidentalHoverAfterTouch(s);
			return;
		}
		(s as any).__lastTouchEndLikeAt = now;
	} catch {
		// ignore
	}
	if (s.touchLongPressTimeout != null) {
		clearTimeout(s.touchLongPressTimeout);
		s.touchLongPressTimeout = null;
	}
	try {
		(s as any).__touchEntryDragArmed = null;
		(s as any).__touchEntryDragMenu = null;
	} catch {
		// ignore
	}
	if (s.touchMode === "entrydrag" || (s as any).entryDragActive) {
		s.touchMode = null;
		s.dragSource = null;
		try {
			(s as any).__touchDragAnchorEntry = null;
		} catch {
			// ignore
		}
		await commitAnchorEntryDrag(canvas);
		suppressIncidentalHoverAfterTouch(s, 650);
		return;
	}
	try {
		(s as any).__touchGestureStartedDuringMotion = false;
		(s as any).__touchCarryVelocity = 0;
	} catch {
		// ignore
	}

	const duration = Date.now() - s.touchStartTime;
	const mode = s.touchMode;
	const touchesRemaining = event.touches.length;
	const hadMultiTouch = s.touchHadMultipleTouches;
	const wasPinch = mode === "pinch";
	const wasTwoFinger = mode === "twofinger";
	{
		const consumeToken = Number((s as any).__touchConsumeActionsToken ?? 0) || 0;
		const activeToken = Number((s as any).__touchGestureActiveToken ?? 0) || 0;
		if (consumeToken > 0 && activeToken > 0 && consumeToken === activeToken) {
			const isTapLike =
				!wasPinch &&
				mode !== "pan" &&
				!s.touchMoved &&
				duration < TAP_MAX_DURATION &&
				!hadMultiTouch &&
				touchesRemaining === 0;
			try {
				(s as any).__touchConsumeActionsToken = 0;
			} catch {
				// ignore
			}
			clearPendingDateTapOpen(s);
			if (isTapLike) {
				try {
					const rect = s.canvas.getBoundingClientRect();
					const x = s.touchStartX - rect.left;
					const y = s.touchStartY - rect.top;
					// Consume the tap (stop momentum) but still arm the double-tap window so
					// a second tap can trigger the intended double-tap action.
					s.lastTapTime = Date.now();
					s.lastTapX = x;
					s.lastTapY = y;
				} catch {
					// ignore
				}
				try {
					s.keepHoverUntilPointerMove = false;
					s.clearHover(true);
				} catch {
					// ignore
				}
				s.touchMode = null;
				s.dragSource = null;
				s.touchMoved = true;
				suppressIncidentalHoverAfterTouch(s);
				s.touchHadMultipleTouches = false;
				return;
			}
		}
	}
	if (wasPinch) {
		s.touchMoved = true;
		s.lastTapTime = 0;
	}
	if (wasTwoFinger) {
		const now = Date.now();
		const quickTwoFinger = now - s.twoFingerStartTime < 600 && !s.twoFingerMoved;
		const rect = s.canvas.getBoundingClientRect();
		const anchorY = s.twoFingerAnchorY;
		s.touchMode = null;
		s.twoFingerStartTime = 0;
		s.twoFingerMoved = false;
		s.twoFingerAnchorX = 0;
		s.twoFingerAnchorY = 0;
		s.dragSource = null;
		let navigated = false;
		if (quickTwoFinger) {
			let direction = 1;
			const height = rect.height;
			if (height > 0) {
				const relativeY = anchorY - rect.top;
				if (relativeY >= 0 && relativeY < height / 2) {
					direction = -1;
				}
			}
			// On mobile, there is often no hover yet (opened file but no pointer). Anchoring
			// the first scroll-nav step from the viewport edge can jump to the newest/oldest
			// target instead of moving relative to the user's current view.
			try {
				if (!s.isPointerDeviceEvent()) {
					(s as any).__scrollNavAnchorMode = "center";
				}
			} catch {
				// ignore
			}
			navigated = s.advanceScrollNav(direction);
			hideHoverPreviewHelper(canvas);

			// Some touchpad/touch implementations emit incidental mousemove/pointer updates
			// during/after a two-finger gesture. Avoid letting those clear the scroll-nav focus
			// until the user actually moves the pointer again.
			try {
				suppressIncidentalHoverAfterTouch(s, 450);
			} catch {
				// ignore
			}
		}
		// Two-finger tap scroll navigation should behave like Alt+Wheel / Alt+UpDown:
		// if we're already at the boundary (no more targets), keep the current hover/focus
		// instead of clearing it.
		if (!quickTwoFinger && !navigated && !s.keepHoverAfterMenu) {
			s.clearHover();
		}
		s.keepHoverAfterMenu = false;
		if (touchesRemaining === 0) {
			s.touchHadMultipleTouches = false;
		}
		return;
	}

	if (mode === "hover") {
		if (!s.keepHoverAfterMenu) {
			s.clearHover();
			suppressIncidentalHoverAfterTouch(s);
		}
		s.touchMode = null;
		// If a menu was opened via long-press, keepHoverAfterMenu should remain true
		// until the menu closes (the menu layer clears it on hide).
		return;
	}

	let didTap = false;

	if (!wasPinch && !s.touchMoved && duration < TAP_MAX_DURATION && !hadMultiTouch) {
		const rect = s.canvas.getBoundingClientRect();
		const x = s.touchStartX - rect.left;
		const y = s.touchStartY - rect.top;

		const now = Date.now();
		const dtTap = now - s.lastTapTime;
		const distVal = Math.hypot(x - s.lastTapX, y - s.lastTapY);

		if (dtTap < DOUBLE_TAP_MAX_DELAY && distVal < DOUBLE_TAP_MAX_DIST) {
			clearPendingDateTapOpen(s);
			await handleDoublePoint(canvas, s.lastTapX, s.lastTapY);
			s.lastTapTime = 0;
		} else {
			// For date labels, defer the single-tap open slightly so a second tap within the
			// double-tap window can reliably trigger create-new-daily without getting
			// overridden by a late async open from the first tap.
			// Preserve the touch hover so quick finger-up doesn't blink.
			s.lastTapTime = now;
			s.lastTapX = x;
			s.lastTapY = y;
			const touchDay = findTouchDayLayoutAtPoint(s, x, y);
			if (touchDay) {
				scheduleDeferredDateTapOpen(canvas, s, x, y);
			} else {
				await handlePointClick(canvas, x, y, false, false, { preserveHoverOnNonPointer: true });
			}
			try {
				(s as any).__touchHoverPinnedUntil = performance.now() + 260;
			} catch {
				// ignore
			}
		}
		didTap = true;
	}

	s.touchMode = null;

	if (mode === "pan") {
		try {
			const panAbs = Number((s as any).__touchPanAbs ?? 0) || 0;
			const panStartedAt = Number((s as any).__touchPanStartedAt ?? 0) || 0;
			const now = performance.now();
			const panDt = panStartedAt > 0 ? (now - panStartedAt) : 0;
			// If the "pan" was extremely short or small, don't apply inertia.
			// This avoids a visible jump on quick taps that accidentally cross the threshold.
			const flickV = Math.abs(Number(s.velocityY) || 0);
			// Allow short, fast flicks to keep momentum even if the gesture was brief.
			// velocityY is in px/ms; 0.18 ~= 180px/s.
			if ((panAbs < 26 || panDt < 120) && flickV < 0.18) {
				s.velocityY = 0;
			}
			(s as any).__touchPanAbs = 0;
			(s as any).__touchPanStartedAt = 0;
			(s as any).__touchCarryVelocity = 0;
		} catch {
			// ignore
		}
		s.startInertia();
	}

	const completedMultiTouch = hadMultiTouch && touchesRemaining === 0;
	if (completedMultiTouch) {
		s.dragSource = null;
		s.touchHadMultipleTouches = false;
		return;
	}

	if (!didTap) {
		if (!s.keepHoverAfterMenu) {
			s.clearHover();
			suppressIncidentalHoverAfterTouch(s);
		} else {
			// Even when we keep hover (menu open), ignore incidental synthetic hover events
			// that can arrive right after touchend and accidentally unhover.
			suppressIncidentalHoverAfterTouch(s, 650);
		}
	} else {
		// After a tap, some platforms emit synthetic hover updates that can shift/clear
		// the touch-established hover, causing a visible "jump".
		suppressIncidentalHoverAfterTouch(s);
	}

	s.dragSource = null;
	if (touchesRemaining === 0) {
		s.touchHadMultipleTouches = false;
	}
}

export function handleTouchCancel(canvas: EpochCanvas, event: TouchEvent): void {
	const s = getEventState(canvas);
	void event;
	try {
		(s as any).__touchConsumeActionsToken = 0;
	} catch {
		// ignore
	}
	clearPendingDateTapOpen(s);
	try {
		const menu = (s as any).__touchEntryDragMenu as any;
		menu?.hide?.();
		menu?.close?.();
	} catch {
		// ignore
	}
	try {
		(s as any).__touchEntryDragArmed = null;
		(s as any).__touchEntryDragMenu = null;
	} catch {
		// ignore
	}
	if ((s as any).entryDragActive) {
		try {
			(s as any).__touchDragAnchorEntry = null;
		} catch {
			// ignore
		}
		cancelAnchorEntryDrag(canvas);
	}
	try {
		(s as any).__lastTouchEndLikeAt = performance.now();
	} catch {
		// ignore
	}
	if (s.touchLongPressTimeout != null) {
		clearTimeout(s.touchLongPressTimeout);
		s.touchLongPressTimeout = null;
	}
	try {
		(s as any).__touchGestureStartedDuringMotion = false;
		(s as any).__touchCarryVelocity = 0;
	} catch {
		// ignore
	}
	// Treat cancel as an aborted gesture: clean up state and prevent any incidental synthetic
	// hover updates, but do not run tap logic.
	s.dragSource = null;
	s.touchMode = null;
	s.touchMoved = true;
	if (!s.keepHoverAfterMenu) {
		suppressIncidentalHoverAfterTouch(s);
	}
}
