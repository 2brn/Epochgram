import { describe, expect, test, vi } from "vitest";

vi.mock("../src/ui/entry-helpers", () => ({
	getEntriesForDate: vi.fn()
}));

import { getEntriesForDate } from "../src/ui/entry-helpers";
import { handlePointClick, handleTapWithHover } from "../src/ui/epoch-canvas-events/interactions";

type AnyEntry = { file: string };

function makeBaseState(overrides: Partial<any> = {}): any {
	const state: any = {
		canvas: { style: { cursor: "" }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
		layouts: [],
		epochsView: false,
		activeFilePath: null,
		isPointerDeviceEvent: () => true,
		keepHoverUntilPointerMove: false,
		setHoverSummary: vi.fn(),
		clearHover: vi.fn(),
		requestHoverAnimation: vi.fn(),
		getToday: () => new Date("2026-01-10T00:00:00.000Z"),
		getDateForIndex: () => new Date("2026-01-10T00:00:00.000Z"),
		openDateNote: vi.fn(async () => true),
		createNoteForDate: vi.fn(async () => undefined),
		resetScrollNavToToday: vi.fn(),
		suppressNextFocusScrollForPath: vi.fn(),
		...overrides
	};
	if (!state.openEntry) {
		state.openEntry = vi.fn(async (entry: AnyEntry) => {
			state.activeFilePath = entry?.file ?? null;
			return undefined;
		});
	}
	return state;
}

describe("compact +n click/tap cycling", () => {
	test("click cycles visible and hidden entries for collapsed row", async () => {
		const e1: AnyEntry = { file: "record1.md" };
		const e2: AnyEntry = { file: "record2.md" };
		const e3: AnyEntry = { file: "record3.md" };
		vi.mocked(getEntriesForDate).mockReturnValue([e1 as any, e2 as any, e3 as any]);

		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry: e1,
			compactTotalCount: 3,
			compactHiddenCount: 2
		} as any;
		const day = { index: 12, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;
		const state = makeBaseState({ layouts: [day] });

		await handlePointClick(state as any, 10, 10, false, false);
		await handlePointClick(state as any, 10, 10, false, false);
		await handlePointClick(state as any, 10, 10, false, false);
		await handlePointClick(state as any, 10, 10, false, false);

		expect(state.openEntry).toHaveBeenCalledTimes(4);
		expect(state.openEntry).toHaveBeenNthCalledWith(1, e1, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(2, e2, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(3, e3, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(4, e1, { ctrlKey: false, metaKey: false }, true);
	});

	test("click resets to visible record when active file changes even within collapsed range", async () => {
		const e1: AnyEntry = { file: "record1.md" };
		const e2: AnyEntry = { file: "record2.md" };
		const e3: AnyEntry = { file: "record3.md" };
		vi.mocked(getEntriesForDate).mockReturnValue([e1 as any, e2 as any, e3 as any]);

		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry: e1,
			compactTotalCount: 3,
			compactHiddenCount: 2
		} as any;
		const day = { index: 12, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;
		const state = makeBaseState({ layouts: [day] });

		await handlePointClick(state as any, 10, 10, false, false);
		await handlePointClick(state as any, 10, 10, false, false);
		state.activeFilePath = "record3.md";
		await handlePointClick(state as any, 10, 10, false, false);

		expect(state.openEntry).toHaveBeenCalledTimes(3);
		expect(state.openEntry).toHaveBeenNthCalledWith(1, e1, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(2, e2, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(3, e1, { ctrlKey: false, metaKey: false }, true);
	});

	test("tap cycles visible and hidden entries for collapsed row", async () => {
		vi.useFakeTimers();
		const e1: AnyEntry = { file: "record1.md" };
		const e2: AnyEntry = { file: "record2.md" };
		const e3: AnyEntry = { file: "record3.md" };
		vi.mocked(getEntriesForDate).mockReturnValue([e1 as any, e2 as any, e3 as any]);

		const rect = {
			x1: 0,
			y1: 0,
			x2: 100,
			y2: 20,
			itemIndex: 0,
			entry: e1,
			compactTotalCount: 3,
			compactHiddenCount: 2
		} as any;
		const day = { index: 12, summaryRects: [rect], hasVisibleDate: false, dateRect: {} } as any;
		const state = makeBaseState({ layouts: [day] });

		const p1 = handleTapWithHover(state as any, 10, 10);
		vi.advanceTimersByTime(130);
		await p1;
		const p2 = handleTapWithHover(state as any, 10, 10);
		vi.advanceTimersByTime(130);
		await p2;
		const p3 = handleTapWithHover(state as any, 10, 10);
		vi.advanceTimersByTime(130);
		await p3;

		expect(state.openEntry).toHaveBeenCalledTimes(3);
		expect(state.openEntry).toHaveBeenNthCalledWith(1, e1, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(2, e2, { ctrlKey: false, metaKey: false }, true);
		expect(state.openEntry).toHaveBeenNthCalledWith(3, e3, { ctrlKey: false, metaKey: false }, true);
		vi.useRealTimers();
	});
});
