import { Notice } from "obsidian";
import type { EpochPlugin } from "../main";
import { EPOCH_BUCKETS } from "../indexer/types";
import { isDateKey } from "./ai-summaries/shared";
import { computeRebuildGating } from "./maintenance-gating";
import type { RebuildSelection } from "./maintenance-types";

type FileDateLike = { date?: string };
type IndexedFileLike = {
	cdate?: FileDateLike;
	namedDate?: FileDateLike;
	contentDates?: FileDateLike[];
	trackedDates?: Record<string, FileDateLike[]>;
};

type RebuildIndexerLike = {
	index?: Record<string, unknown[]>;
	files?: Record<string, IndexedFileLike>;
};

type MaintenancePluginLike = EpochPlugin & {
	openAiBridgeWindow?: (options: { silent: boolean; source: string; forceOpen: boolean }) => Promise<void>;
	rebuildSemanticVectorsWithProgress?: () => Promise<void>;
	rebuildTopicsWithProgress?: () => Promise<void>;
	generateAiSummariesForAllRecords?: () => Promise<void>;
	enqueueEpochsForDateKeys?: (
		dates: string[],
		options: { force: boolean; showNotice: boolean; buckets: readonly string[] }
	) => Promise<void>;
	regenerateEpochsForAllRecords?: () => Promise<void>;
	indexer?: RebuildIndexerLike;
};

export async function runRebuild(plugin: EpochPlugin, sel: RebuildSelection): Promise<void> {
	try {
		await plugin.ensureIndexLoaded();
	} catch {
		// index rebuild will handle its own ensure
	}

	const gate = computeRebuildGating(plugin);
	const state = plugin as MaintenancePluginLike;

	if (sel.index) {
		await plugin.rebuildIndexWithProgress();
	}

	// Everything below is intentionally not awaited: the UI spinner should stop
	// as soon as the index rebuild work completes.
	void (async () => {
		try {
			// User-initiated rebuild: if AI summaries and/or epochs are selected, ensure
			// the bridge page is opened (non-silent) so work can actually run.
			if ((sel.aiSummaries && gate.aiEnabled) || (sel.epochs && gate.epochsEnabled)) {
				try {
					await state.openAiBridgeWindow?.({ silent: false, source: "maintenance", forceOpen: true });
				} catch {
					// ignore
				}
			}
			// The top-level ensureIndexLoaded() is best-effort and intentionally swallowed.
			// For AI summaries/epochs, we must ensure the index is available here too; otherwise,
			// startup rebuilds can run against a partial index and produce incomplete work.
			try {
				await plugin.ensureIndexLoaded();
			} catch {
				// ignore
			}
			if (sel.semantics && gate.semanticsEnabled) {
				new Notice("Epochgram: Rebuilding semantics…", 1500);
				await state.rebuildSemanticVectorsWithProgress?.();
			}
			if (sel.topics && gate.topicsEnabled) {
				new Notice("Epochgram: Rebuilding topics…", 1500);
				await state.rebuildTopicsWithProgress?.();
			}
			if (sel.aiSummaries && gate.aiEnabled) {
				await state.generateAiSummariesForAllRecords?.();
			}
			if (sel.epochs && gate.epochsEnabled) {
				try {
					await plugin.ensureIndexLoaded();
				} catch {
					// ignore
				}
				// Epochs are hierarchical (day -> ... -> year). To ensure parent buckets are generated
				// from freshly-updated child buckets, always cascade regeneration from day upward.
				const indexerState = (plugin as unknown as { indexer?: RebuildIndexerLike }).indexer;
				const index = indexerState?.index ?? {};
				const files = indexerState?.files ?? {};

				const keySet = new Set<string>();
				for (const k of Object.keys(index)) {
					if (isDateKey(k)) keySet.add(k);
				}
				const addEntryDate = (entry: FileDateLike | null | undefined): void => {
					try {
						const d = String(entry?.date ?? "");
						if (isDateKey(d)) keySet.add(d);
					} catch {
						// ignore
					}
				};
				for (const data of Object.values(files)) {
					try {
						addEntryDate(data?.cdate);
						addEntryDate(data?.namedDate);
						for (const e of Array.isArray(data?.contentDates) ? data.contentDates : []) addEntryDate(e);
						const tracked = data?.trackedDates;
						for (const list of Object.values(tracked ?? {})) {
							for (const e of Array.isArray(list) ? list : []) addEntryDate(e);
						}
					} catch {
						// ignore
					}
				}

				const dateKeys = Array.from(keySet.values());
				dateKeys.sort();
				if (dateKeys.length === 0) {
					// no-op
				}
				if (typeof state.enqueueEpochsForDateKeys === "function") {
					await state.enqueueEpochsForDateKeys(dateKeys, { force: true, showNotice: true, buckets: EPOCH_BUCKETS });
				} else {
					await state.regenerateEpochsForAllRecords?.();
				}
			}
		} catch (error) {
			void error;
			try {
				new Notice("Epochgram rebuild failed (see console)", 5000);
			} catch {
				// ignore
			}
		}
	})();
}
