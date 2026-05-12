import { describe, expect, test, vi } from "vitest";
import { handleMouseDown } from "../src/ui/epoch-canvas-events/mouse";
import { handleClick } from "../src/ui/epoch-canvas-events/clicks";

vi.mock("../src/ui/epoch-canvas-hover", () => {
	return {
		hideHoverPreview: vi.fn()
	};
});

describe("wheel interaction input gating", () => {
	test("does not start mouse drag while wheel suppression is active", () => {
			const now = performance.now();
		const state: any = {
			isPointerDeviceEvent: () => true,
			suppressHoverUntil: 0,
				suppressHoverUntilPointerMove: true,
				suppressClickUntil: now + 200,
			animatingView: false,
			animatingWheelZoom: false,
			pendingScrollNavHighlight: null,
			isDragging: false,
			dragSource: null,
			dragStartY: 0,
			dragStartOffsetY: 0,
			lastPanY: 0,
			lastPanTime: performance.now(),
			velocityY: 0,
			mouseDownX: 0,
			mouseDownY: 0,
			mouseDownTime: 0,
			mouseMoved: false,
			keepHoverUntilPointerMove: false,
			entryDragCandidateEntry: { file: "x.md" },
			entryDragCandidateGhostEntry: { file: "x.md" },
			entryDragCandidateStartX: 10,
			entryDragCandidateStartY: 10,
			lastPointerEvent: null
		};

		handleMouseDown(state as any, { button: 0, clientX: 20, clientY: 20, preventDefault: vi.fn() } as any);

		expect(state.isDragging).toBe(false);
		expect(state.entryDragCandidateEntry).toBe(null);
		expect(state.entryDragCandidateGhostEntry).toBe(null);
		expect(state.lastPointerEvent).toBeTruthy();
	});

	test("left-click stops in-flight wheel pan and consumes the click", () => {
		const preventDefault = vi.fn();
		const draw = vi.fn();
		const state: any = {
			isPointerDeviceEvent: () => true,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			animatingView: false,
			animatingWheelZoom: false,
			animatingWheelPan: true,
			offsetY: 100,
			targetOffsetY: 40,
			scale: 1,
			targetScale: 1,
			velocityY: 0,
			draw,
			pendingScrollNavHighlight: null,
			isDragging: false,
			dragSource: null,
			dragStartY: 0,
			dragStartOffsetY: 0,
			lastPanY: 0,
			lastPanTime: performance.now(),
			mouseDownX: 0,
			mouseDownY: 0,
			mouseDownTime: 0,
			mouseMoved: false,
			keepHoverUntilPointerMove: false,
			entryDragCandidateEntry: { file: "x.md" },
			entryDragCandidateGhostEntry: { file: "x.md" },
			entryDragCandidateStartX: 10,
			entryDragCandidateStartY: 10,
			lastPointerEvent: null
		};

		handleMouseDown(state as any, { button: 0, clientX: 20, clientY: 20, preventDefault } as any);

		expect(state.animatingWheelPan).toBe(false);
		expect(state.targetOffsetY).toBe(state.offsetY);
		expect(Number(state.suppressClickUntil)).toBeGreaterThan(0);
		expect(state.isDragging).toBe(false);
		expect(state.entryDragCandidateEntry).toBe(null);
		expect(state.lastPointerEvent).toBeTruthy();
		expect(draw).toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalled();
	});

	test("does not open record on click while wheel suppression is active", async () => {
		const entry = { file: "note.md" } as any;
			const now = performance.now();
		const state: any = {
			canvas: {
				style: { cursor: "" },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 })
			},
			layouts: [
				{
					index: 0,
					summaryRects: [
						{ x1: 0, y1: 0, x2: 120, y2: 24, itemIndex: 0, entry }
					],
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 }
				}
			],
			epochsView: false,
			openEntry: vi.fn(async () => undefined),
			isPointerDeviceEvent: () => true,
			mouseDownTime: performance.now(),
			mouseMoved: false,
			suppressHoverUntil: 0,
				suppressHoverUntilPointerMove: true,
				suppressClickUntil: now + 200,
			keepHoverUntilPointerMove: false,
			setHoverSummary: vi.fn(),
			clearHover: vi.fn(),
			requestHoverAnimation: vi.fn(),
			getToday: () => new Date("2026-01-19T12:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
			openDateNote: vi.fn(async () => true),
			createNoteForDate: vi.fn(async () => undefined),
			resetScrollNavToToday: vi.fn(),
			suppressNextFocusScrollForPath: vi.fn()
		};

		await handleClick(state as any, {
			button: 0,
			clientX: 10,
			clientY: 10,
			ctrlKey: false,
			metaKey: false
		} as any);

		expect(state.openEntry).not.toHaveBeenCalled();
	});

	test("does not open record on click during Alt+wheel scroll-nav", async () => {
		const { handleWheel } = await import("../src/ui/epoch-canvas-events/wheel");
		const entry = { file: "note.md" } as any;
		const state: any = {
			canvas: {
				style: { cursor: "" },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 })
			},
			layouts: [
				{
					index: 0,
					summaryRects: [
						{ x1: 0, y1: 0, x2: 120, y2: 24, itemIndex: 0, entry }
					],
					hasVisibleDate: false,
					dateRect: { x1: 0, y1: 0, x2: 0, y2: 0 }
				}
			],
			epochsView: false,
			openEntry: vi.fn(async () => undefined),
			isPointerDeviceEvent: () => true,
			mouseDownTime: performance.now(),
			mouseMoved: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			setHoverSummary: vi.fn(),
			clearHover: vi.fn(),
			requestHoverAnimation: vi.fn(),
			getToday: () => new Date("2026-01-19T12:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
			openDateNote: vi.fn(async () => true),
			createNoteForDate: vi.fn(async () => undefined),
			resetScrollNavToToday: vi.fn(),
			suppressNextFocusScrollForPath: vi.fn(),
			advanceScrollNav: vi.fn(() => true),
			previewLockedUntilAltRelease: false,
			hoverPreviewKey: "x"
		};

		handleWheel(state as any, {
			preventDefault: vi.fn(),
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			deltaX: 0,
			deltaY: 10
		} as any);

		expect(Number(state.suppressClickUntil)).toBeGreaterThan(0);

		await handleClick(state as any, {
			button: 0,
			clientX: 10,
			clientY: 10,
			ctrlKey: false,
			metaKey: false
		} as any);

		expect(state.openEntry).not.toHaveBeenCalled();
	});
});
