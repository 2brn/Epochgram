import { describe, expect, test, vi } from "vitest";
import { handleHoverMouse, handleMouseDown, handleMouseMove, handleMouseUp } from "../src/ui/epoch-canvas-events/mouse";

describe("mouse drag hover suppression", () => {
	test("click-pan cancels wheel pan animation", () => {
		const state: any = {
			isPointerDeviceEvent: () => true,
			animatingView: false,
			animatingWheelPan: true,
			targetOffsetY: -500,
			targetScale: 1,
			offsetY: 10,
			scale: 1,
			pendingScrollNavHighlight: null,
			isDragging: false,
			dragSource: null,
			dragStartY: 0,
			dragStartOffsetY: 0,
			lastPanY: 0,
			lastPanTime: performance.now() - 16,
			velocityY: 0.2,
			mouseDownX: 0,
			mouseDownY: 0,
			mouseDownTime: 0,
			mouseMoved: false,
			keepHoverUntilPointerMove: false
		};

		handleMouseDown(state as any, { button: 0, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
			expect(state.isDragging).toBe(false);
		expect(state.animatingWheelPan).toBe(false);
		expect(state.targetOffsetY).toBe(10);
			expect(Number(state.suppressClickUntil)).toBeGreaterThan(0);
	});

	test("does not update hover while left button is down", () => {
		const updateHover = vi.fn();
		const state: any = {
			isPointerDeviceEvent: () => true,
			isDragging: false,
			keepHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			lastPointerEvent: null,
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
			updateHover,
			attemptHoverPreview: vi.fn()
		};

		handleHoverMouse(state as any, { clientX: 10, clientY: 20, buttons: 1 } as any);
		expect(updateHover).not.toHaveBeenCalled();
	});

	test("clears hover when drag gesture starts", () => {
		const clearHover = vi.fn();
		const draw = vi.fn();
		const state: any = {
			isPointerDeviceEvent: () => true,
			animatingView: false,
			pendingScrollNavHighlight: null,
			scrollNavIndex: 3,
			scrollNavAnchorEntry: { file: "A.md" },
			scrollNavAnchorDayIndex: 5,
			isDragging: false,
			dragSource: null,
			dragStartY: 0,
			dragStartOffsetY: 0,
			offsetY: 0,
			lastPanY: 0,
			lastPanTime: performance.now() - 16,
			velocityY: 0,
			mouseDownX: 0,
			mouseDownY: 0,
			mouseDownTime: 0,
			mouseMoved: false,
			keepHoverUntilPointerMove: false,
			clearHover,
			draw
		};

		handleMouseDown(state as any, { button: 0, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
		// Move enough to exceed drag threshold (12px).
		handleMouseMove(state as any, { clientX: 30, clientY: 30 } as any);

		expect(state.mouseMoved).toBe(true);
		expect(state.scrollNavIndex).toBe(-1);
		expect(state.scrollNavAnchorEntry).toBe(null);
		expect(state.scrollNavAnchorDayIndex).toBe(null);
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect(draw).toHaveBeenCalledTimes(1);
	});

	test("mouseup after drag keeps hover cleared and suppresses hover briefly", () => {
		const clearHover = vi.fn();
		const state: any = {
			isPointerDeviceEvent: () => true,
			isDragging: true,
			dragSource: "mouse",
			velocityY: 0.3,
			mouseMoved: true,
			suppressHoverUntil: 0,
			clearHover
		};

		handleMouseUp(state as any);
		expect(state.isDragging).toBe(false);
		expect(state.dragSource).toBe(null);
		expect(state.velocityY).toBe(0);
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect(Number(state.suppressHoverUntil)).toBeGreaterThan(0);
	});
});
