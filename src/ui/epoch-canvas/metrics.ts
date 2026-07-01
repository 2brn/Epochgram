import {
	FOCUS_ANCHOR_RATIO,
	SUMMARY_FONT_MIN_PX,
	TODAY_OFFSET_Y_INITIAL
} from "../epoch-canvas-constants";
import { parseFontSize } from "../epoch-canvas-utils";
import type { EpochCanvas } from "../epoch-canvas";

export function getTodayOffset(canvas: EpochCanvas): number {
	const canvasState = canvas as unknown as {
		root?: HTMLElement;
		canvas?: HTMLCanvasElement;
	};
	const root = canvasState.root;
	const rect = root?.getBoundingClientRect();
	if (rect?.height && Number.isFinite(rect.height)) {
		return rect.height * FOCUS_ANCHOR_RATIO;
	}
	const dpr = window.devicePixelRatio || 1;
	const canvasEl = canvasState.canvas;
	if (canvasEl?.height) {
		return (canvasEl.height / dpr) * FOCUS_ANCHOR_RATIO;
	}
	return TODAY_OFFSET_Y_INITIAL;
}

export function scaleFont(font: string, factor: number): string {
	const trimmed = font.trim();
	if (!trimmed || factor === 1) return trimmed;
	const { size, prefix, suffix } = parseFontSize(trimmed);
	const scaled = Math.max(SUMMARY_FONT_MIN_PX, size * factor);
	return `${prefix}${scaled.toFixed(2)}px${suffix}`;
}
