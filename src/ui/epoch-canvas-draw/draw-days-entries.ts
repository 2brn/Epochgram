import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import { getEntriesForDate } from "../entry-helpers";
import { buildRenderIndices, getEntryIndicesWithAnyRecordsInRange, mergeSortedUnique } from "./draw-days-indexing";
import type { CanvasDrawState } from "./state";
export function computeRenderIndicesAndEntries(params: { canvas: EpochCanvas; s: CanvasDrawState; today: Date; minIndex: number; maxIndex: number }): { renderIndices: number[]; entriesByIndex: Map<number, DateEntry[]>; totalVisibleEntries: number } {
	const { canvas, s, today, minIndex, maxIndex } = params;
	const renderIndices = mergeSortedUnique(buildRenderIndices({ today, getDateForIndex: (index, date) => s.getDateForIndex(index, date), minIndex, maxIndex, scale: s.scale }), getEntryIndicesWithAnyRecordsInRange({ canvas, anyS: s, today, minIndex, maxIndex }));
	const entriesByIndex = new Map<number, DateEntry[]>();
	let totalVisibleEntries = 0;
	for (const index of renderIndices) { const entries = getEntriesForDate(canvas, s.getDateForIndex(index, today)); entriesByIndex.set(index, entries); totalVisibleEntries += entries.length; }
	return { renderIndices, entriesByIndex, totalVisibleEntries };
}
