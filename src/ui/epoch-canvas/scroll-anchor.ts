import { BASE_SPACING } from "../epoch-canvas-constants";
import type { EpochCanvas } from "../epoch-canvas";

type ScrollAnchorCanvasState = {
	scale?: number;
	offsetY?: number;
	getTodayOffset?: () => number;
};

export function getScrollAnchorDayIndex(canvas: EpochCanvas): number | null {
	const state = canvas as unknown as ScrollAnchorCanvasState;
	const scale = Number(state.scale ?? 0);
	if (!Number.isFinite(scale) || scale === 0) {
		return null;
	}
	const anchorY = state.getTodayOffset?.() ?? NaN;
	if (!Number.isFinite(anchorY)) {
		return null;
	}
	const offsetY = Number(state.offsetY ?? 0);
	const anchorWorldY = (anchorY - offsetY) / scale;
	if (!Number.isFinite(anchorWorldY)) {
		return null;
	}
	return anchorWorldY / BASE_SPACING;
}
