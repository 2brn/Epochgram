import { describe, expect, test, vi } from "vitest";
import { handleDoublePoint, handlePointClick, handleTapWithHover } from "../src/ui/epoch-canvas-events/interactions";

function makeBaseState(overrides: Partial<any> = {}): any {
	return {
		canvas: {
			style: { cursor: "" },
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
		},
		layouts: [],
		epochsView: false,
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
		getToday: () => new Date("2026-01-19T12:00:00.000Z"),
		getDateForIndex: () => new Date("2026-01-19T00:00:00.000Z"),
		openDateNote: vi.fn(async () => true),
		createNoteForDate: vi.fn(async () => undefined),
		resetScrollNavToToday: vi.fn(),
		findSummaryEntryAtPoint: () => null,
		findDayLayoutAtPoint: () => null,
		suppressNextFocusScrollForPath: vi.fn(),
		...overrides
	};
}

describe("TC-025/TC-026 date click behavior", () => {
	test("single click on date opens daily note only (no fallback)", async () => {
		const day = {
			index: 0,
			summaryRects: [],
			hasVisibleDate: true,
			dateRect: { x1: 0, y1: 0, x2: 100, y2: 20 }
		} as any;
		const state = makeBaseState({ layouts: [day] });

		await handlePointClick(state as any, 10, 10, false, false);

		expect(state.openDateNote).toHaveBeenCalledTimes(1);
		expect(state.openDateNote).toHaveBeenCalledWith(
			expect.any(Date),
			expect.objectContaining({ ctrlKey: false, metaKey: false }),
			true,
			{ allowFallbackToFirstEntry: false }
		);
	});

	test("single tap on date opens daily note only (no fallback)", async () => {
		vi.useFakeTimers();
		const day = {
			index: 0,
			summaryRects: [],
			hasVisibleDate: true,
			dateRect: { x1: 0, y1: 0, x2: 100, y2: 20 }
		} as any;
		const state = makeBaseState({ layouts: [day] });

		const p = handleTapWithHover(state as any, 10, 10);
		vi.advanceTimersByTime(130);
		await p;

		expect(state.openDateNote).toHaveBeenCalledTimes(1);
		expect(state.openDateNote).toHaveBeenCalledWith(
			expect.any(Date),
			undefined,
			true,
			{ allowFallbackToFirstEntry: false }
		);
		vi.useRealTimers();
	});

	test("double click on date always creates a new daily note", async () => {
		const state = makeBaseState({
			findDayLayoutAtPoint: () => ({ index: 0 } as any),
			openDateNote: vi.fn(async () => true)
		});

		await handleDoublePoint(state as any, 10, 10);

		expect(state.openDateNote).toHaveBeenCalledTimes(0);
		expect(state.createNoteForDate).toHaveBeenCalledTimes(1);
	});
});
