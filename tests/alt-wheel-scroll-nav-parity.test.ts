import { describe, expect, test, vi } from "vitest";

import { handleWheel } from "../src/ui/epoch-canvas-events/wheel";

describe("alt+wheel scroll-nav parity", () => {
	test("alt+wheel advances scroll-nav using deltaY only and ignores shift", () => {
		const advanceScrollNav = vi.fn();
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();

			const canvas: any = {
			epochsView: false,
				animatingView: true,
			viewInteractionUntil: 0,
			pendingScrollNavHighlight: null,
			offsetY: 0,
			scale: 1,
			canvas: { getBoundingClientRect: () => ({ top: 0, height: 800 }) },
			root: { getBoundingClientRect: () => ({ height: 800 }) },
			layouts: [],
			clearHover: vi.fn(),
			advanceScrollNav,
			draw,
			requestHoverAnimation
		};

		// Horizontal wheel should NOT trigger navigation.
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 0,
			deltaX: 120,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);
		expect(advanceScrollNav).not.toHaveBeenCalled();
		expect(canvas.viewInteractionUntil).toBe(0);
			expect(canvas.animatingView).toBe(true);

		// Shift+Alt should NOT trigger navigation.
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 120,
			deltaX: 0,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: true
		} as any);
		expect(advanceScrollNav).not.toHaveBeenCalled();
		expect(canvas.viewInteractionUntil).toBe(0);
			expect(canvas.animatingView).toBe(true);

		// Alt + vertical wheel should trigger navigation.
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 120,
			deltaX: 0,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);
		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(advanceScrollNav).toHaveBeenCalledWith(1);
		// Critical: scroll-nav should not mark the view as "interacting" (which suppresses hover/outgoing animations).
		expect(canvas.viewInteractionUntil).toBe(0);
			expect(canvas.animatingView).toBe(true);

		// Alt + negative delta should go "up".
		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: -120,
			deltaX: 0,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);
		expect(advanceScrollNav).toHaveBeenCalledTimes(2);
		expect(advanceScrollNav).toHaveBeenLastCalledWith(-1);
		expect(canvas.viewInteractionUntil).toBe(0);
			expect(canvas.animatingView).toBe(true);
	});

	test("alt+wheel in epochs view advances scroll-nav (no pan)", () => {
		const advanceScrollNav = vi.fn();
		const draw = vi.fn();
		const requestHoverAnimation = vi.fn();

		const canvas: any = {
			epochsView: true,
			animatingView: true,
			viewInteractionUntil: 0,
			pendingScrollNavHighlight: null,
			offsetY: 0,
			scale: 1,
			canvas: { getBoundingClientRect: () => ({ top: 0, height: 800 }) },
			root: { getBoundingClientRect: () => ({ height: 800 }) },
			layouts: [],
			clearHover: vi.fn(),
			advanceScrollNav,
			draw,
			requestHoverAnimation
		};

		handleWheel(canvas, {
			preventDefault: vi.fn(),
			clientY: 10,
			deltaY: 120,
			deltaX: 0,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		} as any);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(advanceScrollNav).toHaveBeenCalledWith(1);
		expect(draw).not.toHaveBeenCalled();
		expect(canvas.offsetY).toBe(0);
	});
});
