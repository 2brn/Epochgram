import { describe, expect, test, vi } from "vitest";

import { resetScrollNavToToday } from "../src/ui/epoch-canvas/scroll-nav";

describe("scroll to Today resets scroll-nav target", () => {
	test("resetScrollNavToToday clears anchor/target state and animates", () => {
		const clearFocusedEpochRange = vi.fn();
		const animateToToday = vi.fn();

		const canvas: any = {
			activeFilePath: "Today.md",
			scrollNavFile: "Old.md",
			scrollNavIndex: 3,
			pendingScrollNavHighlight: { dayIndex: 1, entry: { file: "Old.md" }, date: new Date(), attempts: 0, startedAt: 0 },
			scrollNavAnchorEntry: { file: "Old.md" },
			scrollNavAnchorDayIndex: 7,
			__scrollNavAnchorMode: "summary",
			clearFocusedEpochRange,
			animateToToday
		};

		resetScrollNavToToday(canvas);

		expect(clearFocusedEpochRange).toHaveBeenCalledTimes(1);
		expect(canvas.scrollNavIndex).toBe(-1);
		expect(canvas.pendingScrollNavHighlight).toBe(null);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(canvas.scrollNavAnchorDayIndex).toBe(null);
		expect(canvas.__scrollNavAnchorMode).toBe(null);
		expect(canvas.scrollNavFile).toBe("Today.md");
		expect(animateToToday).toHaveBeenCalledTimes(1);
	});
});
