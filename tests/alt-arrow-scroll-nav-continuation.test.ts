import { describe, expect, test, vi } from "vitest";

import { onWindowKeyDown } from "../src/ui/epoch-canvas-hover/preview";

describe("alt+arrow scroll-nav continuation", () => {
	test("alt+ArrowDown does not cancel animatingView", () => {
		const advanceScrollNav = vi.fn();

		const canvas: any = {
			isPointerDeviceEvent: () => true,
			isEpochsViewActive: () => false,
			animatingView: true,
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
			preventDefault: vi.fn()
		} as any);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(advanceScrollNav).toHaveBeenCalledWith(1);
		expect(canvas.animatingView).toBe(true);
		expect(canvas.previewLockedUntilAltRelease).toBe(true);
		expect(canvas.hoverPreviewKey).toBe(null);
	});

	test("alt+ArrowDown works in epochs view", () => {
		const advanceScrollNav = vi.fn();

		const canvas: any = {
			isPointerDeviceEvent: () => true,
			isEpochsViewActive: () => true,
			animatingView: true,
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
			preventDefault: vi.fn()
		} as any);

		expect(advanceScrollNav).toHaveBeenCalledTimes(1);
		expect(advanceScrollNav).toHaveBeenCalledWith(1);
	});
});
