import type { EpochCanvas } from "../epoch-canvas";

export function resetScrollNavTargetState(canvas: EpochCanvas): void {
	const c = canvas as unknown as {
		scrollNavIndex?: number;
		pendingScrollNavHighlight?: unknown;
		scrollNavAnchorEntry?: unknown;
		scrollNavAnchorDayIndex?: number | null;
		__scrollNavAnchorMode?: unknown;
	};
	c.scrollNavIndex = -1;
	c.pendingScrollNavHighlight = null;
	c.scrollNavAnchorEntry = null;
	c.scrollNavAnchorDayIndex = null;
	try {
		c.__scrollNavAnchorMode = null;
	} catch {
		// ignore
	}
}
