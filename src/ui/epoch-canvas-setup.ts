import type { EpochCanvas } from "./epoch-canvas";

interface CanvasSetupMethods {
	bind(): void;
	resize(): void;
	scheduleVisibilityCheck(): void;
	destroy(): void;
}

export const canvasSetupMethods: CanvasSetupMethods = {
	bind(this: EpochCanvas): void {
		const state = this as any;
		const w: any = state.win ?? window;
		state.root.addEventListener("wheel", state.handleWheel, { passive: false, capture: true });
		if (state.isPointerDeviceEvent()) {
			state.root.addEventListener("pointerdown", state.handleMouseDown, { capture: true });
			w.addEventListener("pointermove", state.handleMouseMoveWindow);
			w.addEventListener("pointerup", state.handleMouseUpWindow);
		} else {
			state.root.addEventListener("mousedown", state.handleMouseDown, { capture: true });
			w.addEventListener("mousemove", state.handleMouseMoveWindow);
			w.addEventListener("mouseup", state.handleMouseUpWindow);
		}
		state.canvas.addEventListener("dblclick", state.handleDblClick);
		state.canvas.addEventListener("contextmenu", state.handleContextMenu);

		state.canvas.addEventListener("mousemove", state.handleMouseMoveCanvas);
		state.canvas.addEventListener("mouseleave", state.handleMouseLeaveCanvas);

		state.canvas.addEventListener("touchstart", state.handleTouchStart, { passive: false });
		state.canvas.addEventListener("touchmove", state.handleTouchMove, { passive: false });
		state.canvas.addEventListener("touchend", state.handleTouchEnd);
		state.canvas.addEventListener("touchcancel", state.handleTouchCancel);
		// On mobile, if the user pans and then lifts outside the canvas,
		// some platforms won't dispatch touchend/cancel back to the element.
		w.addEventListener("touchend", state.handleTouchEnd, true);
		w.addEventListener("touchcancel", state.handleTouchCancel, true);

		state.canvas.addEventListener("click", state.handleClick);
		state.canvas.addEventListener("auxclick", state.handleAuxClick);

		if (state.isPointerDeviceEvent()) {
			w.addEventListener("keydown", state.handleKeyDownWindow, true);
			w.addEventListener("keyup", state.handleKeyUpWindow, true);
		}
	},

	resize(this: EpochCanvas): void {
		const state = this as any;
		const rect = state.canvas?.getBoundingClientRect?.() ?? state.root.getBoundingClientRect();
		const width = rect.width || state.canvas?.clientWidth || state.root.clientWidth;
		const height = rect.height || state.canvas?.clientHeight || state.root.clientHeight;

		try {
			if (Number.isFinite(width) && width > 0) state.__lastKnownCanvasCssWidth = width;
			if (Number.isFinite(height) && height > 0) state.__lastKnownCanvasCssHeight = height;
		} catch {
			// ignore
		}

		// If the view is collapsed/hidden (common when a side panel is collapsed),
		// clear any persistent hover (scroll-nav date hover, touch hover, etc.) so it
		// doesn't reappear when the panel is expanded again.
		if (!width || !height) {
			const wasHidden = (state as any).__epochCanvasHidden === true;
			(state as any).__epochCanvasHidden = true;
			try {
				state.velocityY = 0;
				state.animatingView = false;
				(state as any).animatingWheelPan = false;
				(state as any).animatingWheelZoom = false;
				(state as any).wheelZoomDir = 0;
				state.lastFrameTime = null;
			} catch {
				// ignore
			}
			if (state.animFrame != null) {
				try {
					cancelAnimationFrame(state.animFrame);
				} catch {
					// ignore
				}
				state.animFrame = null;
			}
			if (!wasHidden) {
				try {
					state.keepHoverAfterMenu = false;
					state.keepHoverUntilPointerMove = false;
					state.pendingScrollNavHighlight = null;
					state.clearHover(true);
				} catch {
					// ignore
				}
			}
			return;
		}
		(state as any).__epochCanvasHidden = false;

		const w: any = state.win ?? window;
		const dpr = w.devicePixelRatio || 1;
		const bufWidth = Math.round(width * dpr);
		const bufHeight = Math.round(height * dpr);
		if (bufWidth === state.lastCanvasWidth && bufHeight === state.lastCanvasHeight) {
			return;
		}
		state.lastCanvasWidth = bufWidth;
		state.lastCanvasHeight = bufHeight;
		state.canvas.width = bufWidth;
		state.canvas.height = bufHeight;
		state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		state.draw();
	},

	scheduleVisibilityCheck(this: EpochCanvas): void {
		const state = this as any;
		const w: any = state.win ?? window;
		if (state.visibilityRetryTimeout != null) return;
		if (!state.root?.isConnected) return;
		state.visibilityRetryTimeout = w.setTimeout(() => {
			state.visibilityRetryTimeout = null;
			if (!state.root?.isConnected) return;
			const rect = state.root.getBoundingClientRect();
			if (!rect.width || !rect.height) {
				state.scheduleVisibilityCheck();
				return;
			}
			state.draw();
		}, 150);
	},

	destroy(this: EpochCanvas): void {
		const state = this as any;
		const w: any = state.win ?? window;
		state.cancelFocusClear();
		try {
			w.removeEventListener?.("resize", state.scheduleResize);
			w.visualViewport?.removeEventListener?.("resize", state.scheduleResize);
		} catch {
			// ignore
		}
		try {
			if (state.sizePoller != null) {
				w.clearInterval(state.sizePoller);
				state.sizePoller = null;
			}
		} catch {
			// ignore
		}
		try {
			if (state.postResizeTimeout1 != null) {
				w.clearTimeout(state.postResizeTimeout1);
				state.postResizeTimeout1 = null;
			}
			if (state.postResizeTimeout2 != null) {
				w.clearTimeout(state.postResizeTimeout2);
				state.postResizeTimeout2 = null;
			}
		} catch {
			// ignore
		}
		if (state.resizeObserver) {
			state.resizeObserver.disconnect();
			state.resizeObserver = null;
		}
		state.resizeScheduled = false;
		state.lastCanvasWidth = 0;
		state.lastCanvasHeight = 0;

		state.root.removeEventListener("wheel", state.handleWheel, true);
		state.root.removeEventListener("pointerdown", state.handleMouseDown, true);
		state.root.removeEventListener("mousedown", state.handleMouseDown, true);
		state.canvas.removeEventListener("dblclick", state.handleDblClick);
		state.canvas.removeEventListener("contextmenu", state.handleContextMenu);
		w.removeEventListener("pointermove", state.handleMouseMoveWindow);
		w.removeEventListener("pointerup", state.handleMouseUpWindow);
		w.removeEventListener("mousemove", state.handleMouseMoveWindow);
		w.removeEventListener("mouseup", state.handleMouseUpWindow);

		state.canvas.removeEventListener("mousemove", state.handleMouseMoveCanvas);
		state.canvas.removeEventListener("mouseleave", state.handleMouseLeaveCanvas);

		state.canvas.removeEventListener("touchstart", state.handleTouchStart);
		state.canvas.removeEventListener("touchmove", state.handleTouchMove);
		state.canvas.removeEventListener("touchend", state.handleTouchEnd);
		state.canvas.removeEventListener("touchcancel", state.handleTouchCancel);
		w.removeEventListener("touchend", state.handleTouchEnd, true);
		w.removeEventListener("touchcancel", state.handleTouchCancel, true);

		state.canvas.removeEventListener("click", state.handleClick);
		state.canvas.removeEventListener("auxclick", state.handleAuxClick);

		if (state.isPointerDeviceEvent()) {
			w.removeEventListener("keydown", state.handleKeyDownWindow, true);
			w.removeEventListener("keyup", state.handleKeyUpWindow, true);
		}

		if (state.animFrame != null) {
			try {
				w.cancelAnimationFrame(state.animFrame);
			} catch {
				cancelAnimationFrame(state.animFrame);
			}
			state.animFrame = null;
		}

		if (state.touchLongPressTimeout != null) {
			w.clearTimeout(state.touchLongPressTimeout);
			state.touchLongPressTimeout = null;
		}
		if (state.visibilityRetryTimeout != null) {
			w.clearTimeout(state.visibilityRetryTimeout);
			state.visibilityRetryTimeout = null;
		}
		if (state.dateOverlayTimer != null) {
			w.clearTimeout(state.dateOverlayTimer);
			state.dateOverlayTimer = null;
		}
		if (state.dateOverlayEl?.parentElement) {
			state.dateOverlayEl.parentElement.removeChild(state.dateOverlayEl);
		}
		state.dateOverlayEl = null;
		state.pendingVisibilityDraw = false;
		state.hoverPreviewKey = null;
		state.lastPointerEvent = null;
		state.modKeyActive = false;
	}
};
