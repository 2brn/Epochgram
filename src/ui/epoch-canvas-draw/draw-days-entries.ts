import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { EpochBucketName } from "../epoch-canvas-constants";
import { getEntriesForDate as getEntriesForDateHelper } from "../entry-helpers";
import {
	buildRenderIndices,
	getEntryIndicesWithAnyRecordsInRange,
	getEpochEntryIndicesInRange,
	mergeSortedUnique
} from "./draw-days-indexing";
import type { CanvasDrawState } from "./state";

export function computeRenderIndicesAndEntries(params: {
	canvas: EpochCanvas;
	s: CanvasDrawState;
	anyS: any;
	today: Date;
	minIndex: number;
	maxIndex: number;
	epochsViewActive: boolean;
	epochBucket: EpochBucketName | null;
	prevEpochBucket: EpochBucketName | null;
	bucketFadeT: number;
}): {
	renderIndices: number[];
	entriesByIndex: Map<number, DateEntry[]>;
	prevEntriesByIndex: Map<number, DateEntry[]>;
	totalVisibleEntries: number;
} {
	const { canvas, s, anyS, today, minIndex, maxIndex, epochsViewActive, epochBucket, prevEpochBucket, bucketFadeT } = params;

	let renderIndices = buildRenderIndices({
		today,
		getDateForIndex: (index, todayArg) => s.getDateForIndex(index, todayArg),
		minIndex,
		maxIndex,
		scale: s.scale
	});

	if (epochsViewActive) {
		const epochIndices = getEpochEntryIndicesInRange({
			canvas,
			anyS,
			today,
			epochBucket,
			minIndex,
			maxIndex
		});
		if (epochIndices.length) {
			renderIndices = mergeSortedUnique(renderIndices, epochIndices);
		}
	}

	if (!epochsViewActive) {
		const entryIndices = getEntryIndicesWithAnyRecordsInRange({
			canvas,
			anyS,
			today,
			minIndex,
			maxIndex
		});
		if (entryIndices.length) {
			renderIndices = mergeSortedUnique(renderIndices, entryIndices);
		}
	}

	const entriesByIndex = new Map<number, DateEntry[]>();
	const prevEntriesByIndex = new Map<number, DateEntry[]>();
	let totalVisibleEntries = 0;

	for (const i of renderIndices) {
		const date = s.getDateForIndex(i, today);
		const entries = getEntriesForDateHelper(canvas, date, epochsViewActive && epochBucket ? { epochBucket } : {});
		entriesByIndex.set(i, entries);
		totalVisibleEntries += entries.length;

		if (epochsViewActive && prevEpochBucket && bucketFadeT < 1) {
			const prevEntries = getEntriesForDateHelper(canvas, date, { epochBucket: prevEpochBucket as any });
			prevEntriesByIndex.set(i, prevEntries);
		}
	}

	return { renderIndices, entriesByIndex, prevEntriesByIndex, totalVisibleEntries };
}
