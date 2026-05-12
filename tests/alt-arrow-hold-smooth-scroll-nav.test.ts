import { describe, expect, test, vi } from "vitest";

import { onWindowKeyDown, onWindowKeyUp } from "../src/ui/epoch-canvas-hover/preview";

describe("alt+arrow hold smooth scroll-nav", () => {
	test("quick Alt+ArrowDown tap does not trigger an extra advance", () => {
		vi.useFakeTimers();
		const advanceScrollNav = vi.fn();

		const canvas: any = {
			isPointerDeviceEvent: () => true,
			isEpochsViewActive: () => false,
			advanceScrollNav,
			previewLockedUntilAltRelease: false,
			hoverPreviewKey: null,
			modKeyActive: false
		};

		onWindowKeyDown(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown",
			repeat: false,
			preventDefault: vi.fn()
		} as any);
		expect(advanceScrollNav).toHaveBeenCalledTimes(1);

		// Release quickly (before the hold interval would start).
		onWindowKeyUp(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown"
		} as any);

		vi.advanceTimersByTime(500);
		expect(advanceScrollNav).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});

	test("holding Alt+ArrowDown continuously advances scroll-nav until keyup", () => {
		vi.useFakeTimers();
		const advanceScrollNav = vi.fn();

		const canvas: any = {
			isPointerDeviceEvent: () => true,
			isEpochsViewActive: () => false,
			advanceScrollNav,
			previewLockedUntilAltRelease: false,
			hoverPreviewKey: null,
			modKeyActive: false
		};

		onWindowKeyDown(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown",
			repeat: false,
			preventDefault: vi.fn()
		} as any);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(400);
		expect(advanceScrollNav.mock.calls.length).toBeGreaterThan(1);

		onWindowKeyUp(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown"
		} as any);

		const callsAfterStop = advanceScrollNav.mock.calls.length;
		vi.advanceTimersByTime(400);
		expect(advanceScrollNav.mock.calls.length).toBe(callsAfterStop);

		vi.useRealTimers();
	});

	test("OS key-repeat keydown events do not cause extra discrete jumps", () => {
		vi.useFakeTimers();
		const advanceScrollNav = vi.fn();

		const canvas: any = {
			isPointerDeviceEvent: () => true,
			isEpochsViewActive: () => false,
			advanceScrollNav,
			previewLockedUntilAltRelease: false,
			hoverPreviewKey: null,
			modKeyActive: false
		};

		// initial
		onWindowKeyDown(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown",
			repeat: false,
			preventDefault: vi.fn()
		} as any);
		expect(advanceScrollNav).toHaveBeenCalledTimes(1);

		// repeated keydown should not call advanceScrollNav immediately
		onWindowKeyDown(canvas, {
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			key: "ArrowDown",
			code: "ArrowDown",
			repeat: true,
			preventDefault: vi.fn()
		} as any);
		expect(advanceScrollNav).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});
});
