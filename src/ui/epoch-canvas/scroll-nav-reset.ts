import type { EpochCanvas } from "../epoch-canvas";

export function resetScrollNavTargetState(canvas: EpochCanvas): void {
	const c: any = canvas as any;
	c.scrollNavIndex = -1;
	c.pendingScrollNavHighlight = null;
	c.scrollNavAnchorEntry = null;
	c.scrollNavAnchorDayIndex = null;
	try {
		(c as any).__scrollNavAnchorMode = null;
	} catch {
		// ignore
	}
}
