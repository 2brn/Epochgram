import { BASE_SPACING } from "../epoch-canvas-constants";
import type { EpochCanvas } from "../epoch-canvas";

export function getScrollAnchorDayIndex(canvas: EpochCanvas): number | null {
	if (!Number.isFinite((canvas as any).scale) || (canvas as any).scale === 0) {
		return null;
	}
	const anchorY = (canvas as any).getTodayOffset();
	if (!Number.isFinite(anchorY)) {
		return null;
	}
	const anchorWorldY = (anchorY - (canvas as any).offsetY) / (canvas as any).scale;
	if (!Number.isFinite(anchorWorldY)) {
		return null;
	}
	return anchorWorldY / BASE_SPACING;
}
