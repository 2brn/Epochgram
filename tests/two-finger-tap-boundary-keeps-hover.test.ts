import { describe, it, expect, vi } from "vitest";
import { handleTouchEnd } from "../src/ui/epoch-canvas-events/touch";

describe("two-finger tap scroll-nav boundary", () => {
	it("does not clear hover when quick two-finger tap cannot navigate", async () => {
		const clearHover = vi.fn();
		const advanceScrollNav = vi.fn(() => false);

		const state: any = {
			touchMode: "twofinger",
			touchLongPressTimeout: null,
			touchStartTime: Date.now() - 50,
			touchMoved: false,
			touchHadMultipleTouches: true,

			twoFingerStartTime: Date.now() - 100,
			twoFingerMoved: false,
			twoFingerAnchorX: 50,
			twoFingerAnchorY: 10,

			epochsView: false,
			keepHoverAfterMenu: false,
			dragSource: "touch",
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,

			canvas: {
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
			},

			advanceScrollNav,
			clearHover
		};

		const event: any = {
			touches: [],
			preventDefault: vi.fn()
		};

		await handleTouchEnd(state as any, event);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(clearHover).not.toHaveBeenCalled();
		expect(state.suppressHoverUntilPointerMove).toBe(true);
	});

	it("triggers scroll-nav in epochs view", async () => {
		const clearHover = vi.fn();
		const advanceScrollNav = vi.fn(() => true);

		const state: any = {
			touchMode: "twofinger",
			touchLongPressTimeout: null,
			touchStartTime: Date.now() - 50,
			touchMoved: false,
			touchHadMultipleTouches: true,

			twoFingerStartTime: Date.now() - 100,
			twoFingerMoved: false,
			twoFingerAnchorX: 50,
			twoFingerAnchorY: 10,

			epochsView: true,
			keepHoverAfterMenu: false,
			dragSource: "touch",
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,

			canvas: {
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
			},

			advanceScrollNav,
			clearHover,
			isPointerDeviceEvent: () => false
		};

		const event: any = {
			touches: [],
			preventDefault: vi.fn()
		};

		await handleTouchEnd(state as any, event);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(clearHover).not.toHaveBeenCalled();
	});
});
