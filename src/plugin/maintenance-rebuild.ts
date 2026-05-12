import { Notice } from "obsidian";
import type { EpochPlugin } from "../main";
import { EPOCH_BUCKETS } from "../indexer/types";
import { isDateKey } from "./ai-summaries/shared";
import { computeRebuildGating } from "./maintenance-gating";
import type { RebuildSelection } from "./maintenance-types";

export async function runRebuild(plugin: EpochPlugin, sel: RebuildSelection): Promise<void> {
	try {
		await plugin.ensureIndexLoaded();
	} catch {
		// index rebuild will handle its own ensure
	}

	const gate = computeRebuildGating(plugin);
	const anyPlugin: any = plugin as any;

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
					await anyPlugin.openAiBridgeWindow?.({ silent: false, source: "maintenance", forceOpen: true });
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
				await anyPlugin.rebuildSemanticVectorsWithProgress?.();
			}
			if (sel.topics && gate.topicsEnabled) {
				new Notice("Epochgram: Rebuilding topics…", 1500);
				await anyPlugin.rebuildTopicsWithProgress?.();
			}
			if (sel.aiSummaries && gate.aiEnabled) {
				await anyPlugin.generateAiSummariesForAllRecords?.();
			}
			if (sel.epochs && gate.epochsEnabled) {
				try {
					await (plugin as any).ensureIndexLoaded?.();
				} catch {
					// ignore
				}
				// Epochs are hierarchical (day -> ... -> year). To ensure parent buckets are generated
				// from freshly-updated child buckets, always cascade regeneration from day upward.
				const indexerAny: any = (plugin as any)?.indexer as any;
				const index: Record<string, any[]> = indexerAny?.index ?? {};
				const files: Record<string, any> = indexerAny?.files ?? {};

				const keySet = new Set<string>();
				for (const k of Object.keys(index)) {
					if (isDateKey(k)) keySet.add(k);
				}
				const addEntryDate = (entry: any): void => {
					try {
						const d = String(entry?.date ?? "");
						if (isDateKey(d)) keySet.add(d);
					} catch {
						// ignore
					}
				};
				for (const data of Object.values(files)) {
					try {
						addEntryDate((data as any)?.cdate);
						addEntryDate((data as any)?.namedDate);
						for (const e of Array.isArray((data as any)?.contentDates) ? (data as any).contentDates : []) addEntryDate(e);
						const tracked = (data as any)?.trackedDates ?? {};
						for (const list of Object.values(tracked)) {
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
				if (typeof anyPlugin.enqueueEpochsForDateKeys === "function") {
					await anyPlugin.enqueueEpochsForDateKeys(dateKeys, { force: true, showNotice: true, buckets: EPOCH_BUCKETS });
				} else {
					await anyPlugin.regenerateEpochsForAllRecords?.();
				}
			}
		} catch (error) {
			console.error("Epochgram rebuild (background) failed", error);
			try {
				new Notice("Epochgram rebuild failed (see console)", 5000);
			} catch {
				// ignore
			}
		}
	})();
}
