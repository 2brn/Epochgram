import type { DateEntry } from "../../indexer/types";
import { estimateDenseBarHeightForDenseMode } from "../summary-rendering/dense-height";
import { computeNeedsDenseByWidthFast } from "../summary-rendering/normal-measure";
import {
	SUMMARY_DENSE_GLOBAL_THRESHOLD,
	SUMMARY_MIN_SCALE,
	SUMMARY_MIN_WIDTH,
	SUMMARY_OFFSET_X,
	SUMMARY_RIGHT_MARGIN,
	TIMELINE_X
} from "../epoch-canvas-constants";

export function computeDenseState(params: {
	ctx: CanvasRenderingContext2D;
	entriesByIndex: Map<number, DateEntry[]>;
	renderIndices: number[];
	w: number;
	epochsViewActive: boolean;
	scale: number;
	rowHeight: number;
	fontSmall: string;
	activeFilePath: string | null;
	pathsWithEmbeddingTerm: Set<string> | null;
	pathsWithClassifiedTerm: Set<string> | null;
	termSimilarPaths: Set<string> | null;
}): {
	perDayDenseByIndex: Map<number, boolean>;
	denseBarHeightByIndex: Map<number, number>;
	rightWidthForText: number;
	canRenderTextSummaries: boolean;
	xStart: number;
	globalDenseMode: boolean;
	globalCompactMode: boolean;
} {
	const {
		ctx,
		entriesByIndex,
		renderIndices,
		w,
		epochsViewActive,
		scale,
		rowHeight,
		fontSmall,
		activeFilePath,
		pathsWithEmbeddingTerm,
		pathsWithClassifiedTerm,
		termSimilarPaths
	} = params;

	const perDayDenseByIndex = new Map<number, boolean>();
	const denseBarHeightByIndex = new Map<number, number>();
	const rightWidthForText = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
	const canRenderTextSummaries = (!epochsViewActive) && (scale >= SUMMARY_MIN_SCALE) && (rightWidthForText > SUMMARY_MIN_WIDTH);
	const xStart = TIMELINE_X + SUMMARY_OFFSET_X;
	let globalDenseMode = false;
	let globalCompactMode = false;

	if (!epochsViewActive && scale > SUMMARY_MIN_SCALE && rightWidthForText > SUMMARY_MIN_WIDTH) {
		let quickRenderableRows = 0;
		for (const i of renderIndices) {
			const entries = entriesByIndex.get(i) ?? [];
			if (!entries.length) continue;
			quickRenderableRows += entries.length;
		}
		globalCompactMode = quickRenderableRows >= SUMMARY_DENSE_GLOBAL_THRESHOLD;
	}

	if (!epochsViewActive && scale <= SUMMARY_MIN_SCALE) {
		let quickRenderableRows = 0;
		for (const i of renderIndices) {
			const entries = entriesByIndex.get(i) ?? [];
			if (!entries.length) continue;

			denseBarHeightByIndex.set(
				i,
				estimateDenseBarHeightForDenseMode({ scale, rowHeight, entryCount: entries.length })
			);

			quickRenderableRows += entries.length;
		}

		globalDenseMode = quickRenderableRows >= SUMMARY_DENSE_GLOBAL_THRESHOLD;

		if (!globalDenseMode && canRenderTextSummaries) {
			for (const i of renderIndices) {
				const entries = entriesByIndex.get(i) ?? [];
				if (!entries.length) continue;

				const dense = computeNeedsDenseByWidthFast({
					ctx,
					entries,
					xStart,
					rightWidth: rightWidthForText,
					scale,
					rowHeight,
					fontSmall,
					activeFilePath,
					pathsWithEmbeddingTerm,
					pathsWithClassifiedTerm,
					termSimilarPaths
				});
				if (dense) perDayDenseByIndex.set(i, true);
			}
		}
	}

	return {
		perDayDenseByIndex,
		denseBarHeightByIndex,
		rightWidthForText,
		canRenderTextSummaries,
		xStart,
		globalDenseMode,
		globalCompactMode
	};
}
