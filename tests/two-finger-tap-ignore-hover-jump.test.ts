import { describe, expect, test, vi } from "vitest";

import { handleHoverMouse } from "../src/ui/epoch-canvas-events/mouse";

describe("two-finger tap hover jump suppression", () => {
	test("ignores the next hover mousemove after touch scroll-nav", () => {
		const updateHover = vi.fn();
		const attemptHoverPreview = vi.fn();
		const canvas: any = {
			__ignoreNextHoverMove: true,
			__ignoreHoverUntil: 0,
			previewLockedUntilAltRelease: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
			updateHover,
			attemptHoverPreview,
			lastPointerEvent: null
		};

		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(0);
		expect(canvas.__ignoreNextHoverMove).toBe(false);

		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(1);
	});

	test("ignores hover mousemove within ignore window", () => {
		const updateHover = vi.fn();
		const attemptHoverPreview = vi.fn();
		const canvas: any = {
			__ignoreNextHoverMove: false,
			__ignoreHoverUntil: 150,
			previewLockedUntilAltRelease: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: false,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
			updateHover,
			attemptHoverPreview,
			lastPointerEvent: null
		};

		const spy = vi.spyOn(performance, "now");
		spy.mockReturnValue(100);
		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(0);

		spy.mockReturnValue(200);
		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(1);

		spy.mockRestore();
	});

	test("does not release suppressHoverUntilPointerMove until pointer actually moves", () => {
		const updateHover = vi.fn();
		const attemptHoverPreview = vi.fn();
		const canvas: any = {
			__ignoreNextHoverMove: false,
			__ignoreHoverUntil: 0,
			previewLockedUntilAltRelease: false,
			suppressHoverUntil: 0,
			suppressHoverUntilPointerMove: true,
			keepHoverUntilPointerMove: false,
			canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
			updateHover,
			attemptHoverPreview,
			lastPointerEvent: null
		};

		// First stray mousemove should be ignored and establish the baseline.
		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(0);
		expect(canvas.suppressHoverUntilPointerMove).toBe(true);

		// Stationary mousemove should still be ignored.
		handleHoverMouse(canvas, { clientX: 10, clientY: 20, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(0);
		expect(canvas.suppressHoverUntilPointerMove).toBe(true);

		// Real movement releases suppression.
		handleHoverMouse(canvas, { clientX: 20, clientY: 25, buttons: 0 } as any);
		expect(updateHover).toHaveBeenCalledTimes(1);
		expect(canvas.suppressHoverUntilPointerMove).toBe(false);
	});
});
