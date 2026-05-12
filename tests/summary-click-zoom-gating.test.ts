import { describe, expect, test, vi } from "vitest";
import { handlePointClick, handleTapWithHover } from "../src/ui/epoch-canvas-events/interactions";
import { SUMMARY_MIN_SCALE } from "../src/ui/epoch-canvas-constants";

function makeBaseState(overrides: Partial<any> = {}): any {
	return {
		canvas: { style: { cursor: "" }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
		layouts: [],
		epochsView: false,
		scale: SUMMARY_MIN_SCALE - 0.05,
		offsetY: 0,
		targetScale: 0,
		targetOffsetY: 0,
		animatingView: false,
		root: { getBoundingClientRect: () => ({ height: 1000 }) },
		openEntry: vi.fn(async () => undefined),
		isPointerDeviceEvent: () => true,
		keepHoverUntilPointerMove: false,
		setHoverSummary: vi.fn(),
		clearHover: vi.fn(),
		requestHoverAnimation: vi.fn(),
		getToday: () => new Date(),
		getDateForIndex: () => new Date(),
		openDateNote: vi.fn(async () => true),
		createNoteForDate: vi.fn(async () => undefined),
		resetScrollNavToToday: vi.fn(),
		suppressNextFocusScrollForPath: vi.fn(),
		...overrides
	};
}

describe("summary click zoom gating", () => {
	test("click on dense bar does not auto-zoom", async () => {
		const entry = { file: "foo.md" } as any;
		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry,
			denseBarTotalCount: 50
		} as any;
		const day = { index: 10, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;

		const stateLeft = makeBaseState({ layouts: [day] });
		await handlePointClick(stateLeft as any, 10, 10, false, false);
		expect(stateLeft.openEntry).toHaveBeenCalledTimes(1);
		expect(stateLeft.animatingView).toBe(false);
	});

	test("click on +n-prefixed compact row does not auto-zoom", async () => {
		const entry = { file: "plusn.md" } as any;
		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 5,
			entry,
			compactTotalCount: 200,
			compactHiddenCount: 195
		} as any;
		const day = { index: 40, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;

		const state = makeBaseState({ layouts: [day], scale: SUMMARY_MIN_SCALE + 0.2 });
		await handlePointClick(state as any, 10, 10, false, false);
		expect(state.openEntry).toHaveBeenCalledTimes(1);
		expect(state.animatingView).toBe(false);
	});

	test("click on placeholder does not auto-zoom", async () => {
		const entry = { file: "bar.md" } as any;
		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry,
			isPlaceholder: true
		} as any;
		const day = { index: 20, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;

		const stateLeft = makeBaseState({ layouts: [day], scale: SUMMARY_MIN_SCALE - 0.2 });
		await handlePointClick(stateLeft as any, 10, 10, false, false);
		expect(stateLeft.openEntry).toHaveBeenCalledTimes(1);
		expect(stateLeft.animatingView).toBe(false);

		const stateCtrl = makeBaseState({ layouts: [day], scale: SUMMARY_MIN_SCALE - 0.2 });
		await handlePointClick(stateCtrl as any, 10, 10, true, false);
		expect(stateCtrl.openEntry).toHaveBeenCalledTimes(1);
		expect(stateCtrl.animatingView).toBe(false);
	});

	test("tap on placeholder does not auto-zoom", async () => {
		vi.useFakeTimers();
		const entry = { file: "tap.md" } as any;
		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry,
			isPlaceholder: true
		} as any;
		const day = { index: 30, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;

		const state = makeBaseState({ layouts: [day], scale: SUMMARY_MIN_SCALE - 0.2 });
		const p = handleTapWithHover(state as any, 10, 10);
		vi.advanceTimersByTime(130);
		await p;
		expect(state.animatingView).toBe(false);
		vi.useRealTimers();
	});
});
