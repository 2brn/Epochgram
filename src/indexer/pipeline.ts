import type { TFile } from "obsidian";
import type { EpochPlugin } from "../main";
import type { ProcessOptions } from "./indexer";
import type { DateSource, EpochIndex, FileDateEntry, FileIndexData } from "./types";

export interface IndexerPipeline {
	plugin: EpochPlugin;
	index: EpochIndex;
	files: Record<string, FileIndexData>;
	latestLines: Record<string, string[]>;

	readFileContent(file: TFile, reason?: ProcessOptions["reason"]): Promise<string>;
	buildFileDateEntry(
		file: TFile,
		lines: string[],
		date: string,
		isMd: boolean,
		source: DateSource
	): FileDateEntry;
	buildNamedDateEntries(
		file: TFile,
		lines: string[],
		isMd: boolean
	): { anchor: FileDateEntry | null; rangeEntries: FileDateEntry[] };
	buildContentDates(file: TFile, lines: string[]): FileDateEntry[];
	updateTrackedDates(file: TFile, data: FileIndexData, lines: string[]): void;
	updateAggregatedEntries(filePath: string, options?: { skipSort?: boolean }): void;

	buildMergedDates(data: FileIndexData): FileDateEntry[];
	today(): Date;
	isDateBefore(a: string | null | undefined, b: string | null | undefined): boolean;
}
