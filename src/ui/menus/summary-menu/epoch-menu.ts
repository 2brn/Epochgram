import { Menu, Platform } from "obsidian";
import { isEpochBucket, type DateEntry, type EpochBucket } from "../../../indexer/types";
import type { EpochCanvas } from "../../epoch-canvas";
import type { CanvasMenuState } from "../menu-state";
import { getEpochRangeFromEntry } from "../../epoch-canvas-utils";
import { isGenerateEpochsEffective } from "../../../plugin/pro-feature-state";
import { addMenuTitle } from "../menu-title";

type EpochPluginLike = CanvasMenuState["plugin"] & {
	settings?: { generateEpochs?: boolean };
	enqueueEpochsForDateKeys?: (
		dateKeys: string[],
		options: { force?: boolean; showNotice?: boolean; buckets?: EpochBucket[] }
	) => void;
};

type EpochEntryLike = DateEntry & { epochBucket?: unknown; date?: unknown };

function parseDateKeyToUtcDate(key: string): Date | null {
	const [year, month, day] = String(key || "")
		.split("-")
		.map((part) => Number(part));
	if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function addEpochMenuIfApplicable(
	menu: Menu,
	state: CanvasMenuState,
	canvas: EpochCanvas,
	entry: DateEntry
): boolean {
	if (!String(entry?.file || "").startsWith("epoch://")) return false;
	const range = getEpochRangeFromEntry(entry);
	const title = range ? `Epoch ${range.start} - ${range.end}` : "Epoch";
	const plugin: EpochPluginLike = state.plugin;

	addMenuTitle(menu, title, "hourglass");
	menu.addSeparator();

	if (Platform.isDesktop) {
		const enabled =
			isGenerateEpochsEffective(plugin) &&
			plugin?.settings?.generateEpochs === true &&
			typeof plugin?.enqueueEpochsForDateKeys === "function" &&
			range != null;

		menu.addItem((item) => {
			item
				.setTitle(!enabled ? "Regenerate… (Pro)" : "Regenerate…")
				.setIcon("rotate-cw")
				.setDisabled(!range)
				.onClick(() => {
					if (!range) return;
					// If epochs generation is available, queue regeneration.
					if (!enabled) {
						if (!isGenerateEpochsEffective(plugin)) state.requirePro("Generate Epochs");
						return;
					}
					const epochEntry = entry as EpochEntryLike;
					const bucketRaw2 = String(epochEntry.epochBucket || "");
					if (!bucketRaw2 || !isEpochBucket(bucketRaw2)) return;
					const bucket: EpochBucket = bucketRaw2;
					// Regenerate only this epoch (not the full hierarchy). Using the epoch start date key
					// is usually sufficient because bucket→range mapping is deterministic.
					// However, in epochs view the clicked epoch may be rendered on a specific day within
					// its range; prefer that day key when available to avoid targeting an adjacent epoch.
					const entryDayKey = String(epochEntry.date ?? "");
					const useEntryDay = !!entryDayKey && !!parseDateKeyToUtcDate(entryDayKey) && entryDayKey >= range.start && entryDayKey <= range.end;
					const regenKey = useEntryDay ? entryDayKey : range.start;
					void plugin.enqueueEpochsForDateKeys?.([regenKey], { force: true, showNotice: true, buckets: [bucket] });
				});
		});
	}

	return true;
}
