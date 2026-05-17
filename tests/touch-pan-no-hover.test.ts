import { describe, expect, test, vi } from "vitest";
import { handleTouchEnd, handleTouchMove, handleTouchStart } from "../src/ui/epoch-canvas-events/touch";
import { handleHoverMouse } from "../src/ui/epoch-canvas-events/mouse";

type TouchLike = { clientX: number; clientY: number };

const makeEvent = (touches: TouchLike[]) =>
	({
		preventDefault: vi.fn(),
		touches
	}) as any;

describe("touch pan", () => {
	test("does not update hover while panning", () => {
		const updateHover = vi.fn();
		const draw = vi.fn();

		const state: any = {
			// touch state
			touchMode: "pan",
			touchMoved: true,
			touchStartX: 10,
			touchStartY: 20,
			touchStartOffsetY: 0,
			offsetY: 0,
			lastPanY: 20,
			lastPanTime: performance.now() - 16,
			velocityY: 0,

			// required misc fields
			touchLongPressTimeout: null,
			twoFingerAnchorX: 0,
			twoFingerAnchorY: 0,
			twoFingerMoved: false,
			pinchStartDist: 0,
			pinchStartScale: 1,
			pinchAnchorWorldY: 0,

			canvas: {
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
			},

			updateHover,
			draw,
			clearHover: vi.fn(),
			dragSource: null
		};

		const event = makeEvent([{ clientX: 10, clientY: 40 }]);
		handleTouchMove(state as any, event);

		expect(updateHover).not.toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
	});

	test("clears hover when pan gesture begins", () => {
		const updateHover = vi.fn();
		const draw = vi.fn();
		const clearHover = vi.fn();

		const state: any = {
			// touch state: start as not moved and not in a mode
			touchMode: null,
			touchMoved: false,
			scrollNavIndex: 4,
			scrollNavAnchorEntry: { file: "A.md" },
			scrollNavAnchorDayIndex: 6,
			touchStartX: 10,
			touchStartY: 20,
			touchStartOffsetY: 0,
			offsetY: 0,
			lastPanY: 20,
			lastPanTime: performance.now() - 16,
			velocityY: 0,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,

			touchLongPressTimeout: null,
			twoFingerAnchorX: 0,
			twoFingerAnchorY: 0,
			twoFingerMoved: false,
			pinchStartDist: 0,
			pinchStartScale: 1,
			pinchAnchorWorldY: 0,
			isPointerDeviceEvent: () => false,
			attemptHoverPreview: vi.fn(),
			keepHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			lastPointerEvent: null,

			canvas: {
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
			},

			updateHover,
			draw,
			clearHover,
			dragSource: null
		};

		// Move far enough to exceed the pan threshold (8px)
		const event = makeEvent([{ clientX: 10, clientY: 40 }]);
		handleTouchMove(state as any, event);

		expect(state.touchMode).toBe("pan");
		expect(state.scrollNavIndex).toBe(-1);
		expect(state.scrollNavAnchorEntry).toBe(null);
		expect(state.scrollNavAnchorDayIndex).toBe(null);
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect(updateHover).not.toHaveBeenCalled();
	});

	test("mobile pan start suppresses incidental hover mousemove", () => {
		const updateHover = vi.fn();
		const draw = vi.fn();
		const clearHover = vi.fn();

		const state: any = {
			touchMode: null,
			touchMoved: false,
			touchStartX: 10,
			touchStartY: 20,
			touchStartOffsetY: 0,
			offsetY: 0,
			lastPanY: 20,
			lastPanTime: performance.now() - 16,
			velocityY: 0,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			lastPointerEvent: null,
			attemptHoverPreview: vi.fn(),
			isPointerDeviceEvent: () => false,

			touchLongPressTimeout: null,
			twoFingerAnchorX: 0,
			twoFingerAnchorY: 0,
			twoFingerMoved: false,
			pinchStartDist: 0,
			pinchStartScale: 1,
			pinchAnchorWorldY: 0,

			canvas: {
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
			},

			updateHover,
			draw,
			clearHover,
			dragSource: null
		};

		// Trigger pan start.
		handleTouchMove(state as any, makeEvent([{ clientX: 10, clientY: 40 }]));
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect((state as any).__ignoreNextHoverMove).toBe(true);
		expect(Number((state as any).__ignoreHoverUntil ?? 0)).toBeGreaterThan(0);
		expect(state.suppressHoverUntilPointerMove).toBe(true);

		// Simulate a synthetic hover mousemove; should be ignored.
		handleHoverMouse(state as any, { clientX: 12, clientY: 30, buttons: 0 } as any);
		expect(updateHover).not.toHaveBeenCalled();
	});

	test("short fast flick preserves inertia", async () => {
		vi.useFakeTimers();
		const startInertia = vi.fn();
		const clearHover = vi.fn();
		const state: any = {
			// touch state
			touchMode: "pan",
			touchMoved: true,
			touchStartX: 10,
			touchStartY: 20,
			touchStartOffsetY: 0,
			touchStartTime: Date.now() - 80,
			touchHadMultipleTouches: false,
			keepHoverAfterMenu: false,
			lastTapTime: 0,
			lastTapX: 0,
			lastTapY: 0,
			// inertia
			velocityY: 0.4,
			// required misc fields
			dragSource: "touch",
			touchLongPressTimeout: null,
			twoFingerStartTime: 0,
			twoFingerAnchorX: 0,
			twoFingerAnchorY: 0,
			twoFingerMoved: false,
			epochsView: false,
			pendingScrollNavHighlight: null,
			animatingView: false,
			clearHover,
			startInertia,
			isPointerDeviceEvent: () => false,
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }
		};
		(state as any).__touchPanAbs = 10;
		(state as any).__touchPanStartedAt = performance.now() - 80;

		await handleTouchEnd(state as any, { touches: [], preventDefault: vi.fn() } as any);

		expect(startInertia).toHaveBeenCalledTimes(1);
		expect(state.velocityY).toBeGreaterThan(0.01);
		vi.useRealTimers();
	});

	test("pan after interrupting momentum still starts inertia", async () => {
		const startInertia = vi.fn();
		const draw = vi.fn();
		const state: any = {
			// moving state (inertia in progress)
			animatingView: false,
			velocityY: 0.25,
			animatingWheelPan: false,
			animatingWheelZoom: false,
			offsetY: 0,
			targetOffsetY: 0,
			scale: 1,
			targetScale: 1,

			// touch state
			touchMode: null,
			touchMoved: false,
			touchStartX: 0,
			touchStartY: 0,
			touchStartOffsetY: 0,
			touchStartTime: 0,
			touchHadMultipleTouches: false,
			touchLongPressTimeout: null,
			lastTapTime: 0,
			lastTapX: 0,
			lastTapY: 0,
			keepHoverAfterMenu: false,
			keepHoverUntilPointerMove: false,
			pendingScrollNavHighlight: null,
			dragSource: null,
			lastPanY: 0,
			lastPanTime: performance.now() - 16,
			viewInteractionUntil: 0,

			// required misc
			isPointerDeviceEvent: () => false,
			attemptHoverPreview: vi.fn(),
			clearHover: vi.fn(),
			updateHover: vi.fn(),
			findSummaryEntryAtPoint: vi.fn(() => null),
			findDayLayoutAtPoint: vi.fn(() => null),
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
			layouts: [
				{
					index: 0,
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					summaryRects: []
				}
			],
			draw,
			startInertia,
			resetScrollNavToToday: vi.fn(),
			advanceScrollNav: vi.fn(() => false),
			epochsView: false,
			toggleEmptyAreaView: vi.fn(),
			showSummaryMenu: vi.fn(),
			showDateMenu: vi.fn(),
			openEntry: vi.fn(async () => undefined),
			openDateNote: vi.fn(async () => false),
			createNoteForDate: vi.fn(async () => undefined),
			getToday: () => new Date("2026-01-19T12:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			lastPointerEvent: null
		};

		// Touch down while momentum is active (this should stop motion but not block a later pan).
		handleTouchStart(state as any, makeEvent([{ clientX: 10, clientY: 10 }]) as any);
		// Move enough to start pan.
		handleTouchMove(state as any, makeEvent([{ clientX: 10, clientY: 40 }]) as any);
		// One more move to establish velocity.
		state.lastPanTime = performance.now() - 16;
		handleTouchMove(state as any, makeEvent([{ clientX: 10, clientY: 80 }]) as any);

		await handleTouchEnd(state as any, { touches: [], preventDefault: vi.fn() } as any);
		expect(startInertia).toHaveBeenCalledTimes(1);
		expect(Number(state.velocityY) || 0).toBeGreaterThan(0.25);
	});

	test("swipe hide does not fire when touch starts during inertia", () => {
		const collapse = vi.fn();
		const state: any = {
			// moving state (inertia in progress)
			animatingView: false,
			velocityY: 0.25,
			animatingWheelPan: false,
			animatingWheelZoom: false,
			offsetY: 0,
			targetOffsetY: 0,
			scale: 1,
			targetScale: 1,

			// touch state
			touchMode: null,
			touchMoved: false,
			touchStartX: 10,
			touchStartY: 10,
			touchStartOffsetY: 0,
			touchStartTime: 0,
			touchHadMultipleTouches: false,
			touchLongPressTimeout: null,
			lastTapTime: 0,
			lastTapX: 0,
			lastTapY: 0,
			keepHoverAfterMenu: false,
			keepHoverUntilPointerMove: false,
			pendingScrollNavHighlight: null,
			dragSource: null,
			lastPanY: 10,
			lastPanTime: performance.now() - 16,
			viewInteractionUntil: 0,

			// required misc
			isPointerDeviceEvent: () => false,
			attemptHoverPreview: vi.fn(),
			clearHover: vi.fn(),
			updateHover: vi.fn(),
			findSummaryEntryAtPoint: vi.fn(() => null),
			findDayLayoutAtPoint: vi.fn(() => null),
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
			layouts: [
				{
					index: 0,
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					summaryRects: []
				}
			],
			draw: vi.fn(),
			startInertia: vi.fn(),
			resetScrollNavToToday: vi.fn(),
			advanceScrollNav: vi.fn(() => false),
			epochsView: false,
			toggleEmptyAreaView: vi.fn(),
			showSummaryMenu: vi.fn(),
			showDateMenu: vi.fn(),
			openEntry: vi.fn(async () => undefined),
			openDateNote: vi.fn(async () => false),
			createNoteForDate: vi.fn(async () => undefined),
			getToday: () => new Date("2026-01-19T12:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			lastPointerEvent: null,
			plugin: {
				app: {
					workspace: {
						detachLeavesOfType: vi.fn(),
						rightSplit: { collapse }
					}
				}
			}
		};

		handleTouchStart(state as any, makeEvent([{ clientX: 10, clientY: 10 }]) as any);
		expect((state as any).__touchGestureStartedDuringMotion).toBe(true);
		handleTouchMove(state as any, makeEvent([{ clientX: 30, clientY: 12 }]) as any);

		expect(collapse).not.toHaveBeenCalled();
		expect(state.touchMode).toBe("pan");
	});

	test("touchstart during motion suppresses touch hover feedback", () => {
		vi.useFakeTimers();
		const updateHover = vi.fn();
		const state: any = {
			// moving state
			animatingView: false,
			velocityY: 0.2,
			animatingWheelPan: false,
			animatingWheelZoom: false,
			offsetY: 0,
			targetOffsetY: 0,
			scale: 1,
			targetScale: 1,

			// touch state
			touchMode: null,
			touchMoved: false,
			touchStartX: 0,
			touchStartY: 0,
			touchStartOffsetY: 0,
			touchStartTime: 0,
			touchHadMultipleTouches: false,
			touchLongPressTimeout: null,
			keepHoverAfterMenu: false,
			keepHoverUntilPointerMove: false,
			pendingScrollNavHighlight: null,
			dragSource: null,
			lastPanY: 0,
			lastPanTime: performance.now() - 16,
			viewInteractionUntil: 0,
			lastTapTime: 0,
			lastTapX: 0,
			lastTapY: 0,

			// required misc
			isPointerDeviceEvent: () => false,
			attemptHoverPreview: vi.fn(),
			clearHover: vi.fn(),
			updateHover,
			findSummaryEntryAtPoint: vi.fn(() => null),
			findDayLayoutAtPoint: vi.fn(() => null),
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
			layouts: [
				{
					index: 0,
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 },
					summaryRects: [{ x1: 0, y1: 0, x2: 50, y2: 50, entry: { file: "x.md" } }]
				}
			],
			draw: vi.fn(),
			startInertia: vi.fn(),
			resetScrollNavToToday: vi.fn(),
			advanceScrollNav: vi.fn(() => false),
			epochsView: false,
			toggleEmptyAreaView: vi.fn(),
			showSummaryMenu: vi.fn(),
			showDateMenu: vi.fn(),
			openEntry: vi.fn(async () => undefined),
			openDateNote: vi.fn(async () => false),
			createNoteForDate: vi.fn(async () => undefined),
			getToday: () => new Date("2026-01-19T12:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			previewLockedUntilAltRelease: false,
			lastPointerEvent: null
		};

		handleTouchStart(state as any, makeEvent([{ clientX: 10, clientY: 10 }]) as any);
		vi.runAllTimers();
		expect(updateHover).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
