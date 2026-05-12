import {
	BASE_SPACING,
	SUMMARY_MARGIN,
	SUMMARY_MIN_SCALE,
	SUMMARY_PLACEHOLDER_STROKE_WIDTH
} from "../epoch-canvas-constants";

export function estimateDenseBarPartitionCount(params: {
	scale: number;
	rowHeight: number;
	entryCount: number;
}): number {
	const scale = Number(params.scale);
	const rowHeight = Number(params.rowHeight);
	const entryCount = Math.max(0, Math.floor(Number(params.entryCount)));
	if (!Number.isFinite(scale) || !Number.isFinite(rowHeight) || rowHeight <= 0 || entryCount <= 0) return 0;

	const daySpacingPx = BASE_SPACING * scale;
	const halfSpan = Math.max(rowHeight / 2, daySpacingPx / 2 - SUMMARY_MARGIN);
	const bandHeight = Math.max(rowHeight, halfSpan * 2);
	const maxRows = Math.max(1, Math.floor(bandHeight / rowHeight));
	return Math.max(1, Math.min(maxRows, entryCount));
}

export function estimateDenseBarHeightForDenseMode(params: {
	scale: number;
	rowHeight: number;
	entryCount: number;
}): number {
	const scale = Number(params.scale);
	const rowHeight = Number(params.rowHeight);
	const entryCount = Math.max(0, Math.floor(Number(params.entryCount)));
	if (!Number.isFinite(scale) || !Number.isFinite(rowHeight) || rowHeight <= 0 || entryCount <= 0) return 0;

	// If we are in text-capable zoom, dense mode should show multiple thin bars per day
	// (one per visible "row slot"), so users can zoom in and see more structure even
	// when there are too many records to render as text.
	if (scale > SUMMARY_MIN_SCALE) {
		const rows = estimateDenseBarPartitionCount({ scale, rowHeight, entryCount });
		const strokeH = SUMMARY_PLACEHOLDER_STROKE_WIDTH;
		return Math.max(strokeH, (rows - 1) * rowHeight + strokeH);
	}

	// When zoomed out, normal summaries render as thin placeholder strokes. Dense bars
	// should have the same minimum thickness as a placeholder stroke, and scale with
	// density (4 entries per placeholder-height).
	const entriesPerUnit = 4;
	const units = Math.max(1, Math.ceil(entryCount / entriesPerUnit));
	return units * SUMMARY_PLACEHOLDER_STROKE_WIDTH;
}
