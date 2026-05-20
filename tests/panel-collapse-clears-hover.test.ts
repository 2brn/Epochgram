import { describe, expect, it, vi } from "vitest";
import { canvasSetupMethods } from "../src/ui/epoch-canvas-setup";

function makeCollapsedCanvas(overrides: Record<string, unknown> = {}): any {
	const canvas: any = {
		__epochCanvasHidden: false,
		keepHoverAfterMenu: true,
		keepHoverUntilPointerMove: true,
		pendingScrollNavHighlight: { dayIndex: 1 },
		hoverDateIndex: 5,
		hoverSummary: { dayIndex: 2, itemIndex: 3 },
		clearHover: vi.fn(function (this: any) {
			this.hoverDateIndex = null;
			this.hoverSummary = null;
		}),
		root: {
			clientWidth: 0,
			clientHeight: 0,
			getBoundingClientRect: () => ({ width: 0, height: 0 })
		},
		canvas: {
			clientWidth: 0,
			clientHeight: 0,
			getBoundingClientRect: () => ({ width: 0, height: 0 })
		},
		...overrides
	};
	return canvas;
}

describe("panel collapse", () => {
	it("clears hover when resized to 0x0", () => {
		const c = makeCollapsedCanvas();
		canvasSetupMethods.resize.call(c);
		expect(c.clearHover).toHaveBeenCalledTimes(1);
		expect(c.keepHoverAfterMenu).toBe(false);
		expect(c.keepHoverUntilPointerMove).toBe(false);
		expect(c.pendingScrollNavHighlight).toBe(null);
		expect(c.hoverDateIndex).toBe(null);
		expect(c.hoverSummary).toBe(null);
	});

	it("does not repeatedly clear on subsequent zero-size resizes", () => {
		const c = makeCollapsedCanvas();
		canvasSetupMethods.resize.call(c);
		canvasSetupMethods.resize.call(c);
		expect(c.clearHover).toHaveBeenCalledTimes(1);
	});

	it("stops in-flight motion when resized to 0x0", () => {
		const originalCancel = (globalThis as any).cancelAnimationFrame;
		const cancel = vi.fn();
		(globalThis as any).cancelAnimationFrame = cancel;
		try {
			const c = makeCollapsedCanvas({
				velocityY: 0.35,
				animatingView: true,
				animatingWheelPan: true,
				animatingWheelZoom: true,
				wheelZoomDir: 1,
				lastFrameTime: 123,
				animFrame: 77
			});
			canvasSetupMethods.resize.call(c);
			expect(c.velocityY).toBe(0);
			expect(c.animatingView).toBe(false);
			expect(c.animatingWheelPan).toBe(false);
			expect(c.animatingWheelZoom).toBe(false);
			expect(c.wheelZoomDir).toBe(0);
			expect(c.lastFrameTime).toBe(null);
			expect(c.animFrame).toBe(null);
			expect(cancel).toHaveBeenCalledWith(77);
		} finally {
			(globalThis as any).cancelAnimationFrame = originalCancel;
		}
	});
});
