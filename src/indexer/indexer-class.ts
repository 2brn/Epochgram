import { MarkdownView, TFile } from "obsidian";
import type { DateSource, EpochIndex, FileDateEntry, FileIndexData, ReviewState, SerializedEpochIndex } from "./types";
import { isTodayPinMode } from "./types";
import type { EpochPlugin } from "../main";
import { parseAnyDates } from "./extractor";
import { formatDate, frontmatterToIndexTokens, parseDateFromDailyNoteFormat } from "../utils";
import { sortIndex } from "./indexer-utils";
import { resolveSummaryForFile, stripDatesFromContentSummaryText } from "./summary-helpers";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { mergeConsecutiveEntries } from "./content-merger";
import { processFileInternal } from "./process-file";
import { updateAggregatedEntriesInternal } from "./update-aggregated-entries";
import type { IndexerPipeline } from "./pipeline";
import { getYamlDatePropertyKey } from "../plugin/frontmatter-keys";
import { normalizeSerializedEpochIndexForDisk } from "./disk-serialization";
import * as updates from "./entry-updates";
import * as review from "./review-updates";
import { mergeFileReviewStates } from "./review-state-sync";
import { bumpTimelineSearchIndexVersion } from "../plugin/timeline-search-cache";
import { removeFile, renameFile } from "./file-ops";

export interface ProcessOptions {
	reason?: "rebuild" | "modify" | "create" | "open" | "rename";
	previous?: FileIndexData;
	skipSort?: boolean;
}

export class Indexer {
	index: EpochIndex = {};
	revision = 0;
	private files: Record<string, FileIndexData> = {};
	private latestLines: Record<string, string[]> = {};
	private lastSyntheticRefreshTodayKey: string | null = null;
	constructor(private plugin: unknown) {}
	private getPipeline(): IndexerPipeline {
		const getIndexer = () => this;
		return {
			plugin: this.plugin as EpochPlugin,
			get index() { return getIndexer().index; }, set index(v) { getIndexer().index = v; },
			get files() { return getIndexer().files; }, get latestLines() { return getIndexer().latestLines; },
			readFileContent: this.readFileContent.bind(this),
			buildFileDateEntry: this.buildFileDateEntry.bind(this),
			buildNamedDateEntries: this.buildNamedDateEntries.bind(this),
			buildContentDates: this.buildContentDates.bind(this),
			updateAggregatedEntries: this.updateAggregatedEntries.bind(this),
			buildMergedDates: this.buildMergedDates.bind(this),
			today: this.today.bind(this)
		};
	}
	async load(serialized: SerializedEpochIndex | undefined): Promise<void> {
		this.revision++;
		const data = serialized ? normalizeSerializedEpochIndexForDisk(serialized) : { files: {}, dates: {} };
		this.files = data.files;
		this.index = sortIndex(data.dates);
		this.latestLines = {};
		this.refreshSyntheticEntries();
	}
	refreshSyntheticEntries(): void {
		for (const [path, data] of Object.entries(this.files)) {
			if (isTodayPinMode(data.pinnedFile) || data.recur) this.updateAggregatedEntries(path, { skipSort: true });
		}
		this.index = sortIndex(this.index);
	}
	refreshSyntheticEntriesIfDayChanged(): boolean {
		const key = formatDate(this.today());
		if (key === this.lastSyntheticRefreshTodayKey) return false;
		this.lastSyntheticRefreshTodayKey = key;
		this.refreshSyntheticEntries();
		return true;
	}
	toJSON(): SerializedEpochIndex { return normalizeSerializedEpochIndexForDisk({ files: this.files, dates: sortIndex(this.index) }); }
	async rebuildAll(files: TFile[], onProgress?: (processed: number, total: number) => void): Promise<void> {
		this.revision++;
		const previousFiles = this.files;
		const previousIndex = this.index;
		const previousLines = this.latestLines;
		this.files = {};
		this.index = {};
		this.latestLines = {};
		try {
			let processed = 0;
			for (const file of files) {
				this.checkCancellation();
				await this.processFile(file, { reason: "rebuild", previous: previousFiles[file.path], skipSort: true });
				onProgress?.(++processed, files.length);
			}
			this.checkCancellation();
			this.index = sortIndex(this.index);
		} catch (error) { this.files = previousFiles; this.index = previousIndex; this.latestLines = previousLines; throw error; }
	}
	async reprocessAll(files: TFile[], onProgress?: (processed: number, total: number) => void): Promise<void> {
		await this.rebuildAll(files, onProgress);
	}
	private checkCancellation(): void {
		if ((this.plugin as { __epochUnloaded?: boolean }).__epochUnloaded || (this.plugin as { __epochCancelRequestedAt?: { index?: number } }).__epochCancelRequestedAt?.index) throw Object.assign(new Error("EPOCH_CANCELLED"), { code: "EPOCH_CANCELLED" });
	}
	async processFile(file: TFile, options: ProcessOptions = {}): Promise<void> { await processFileInternal(this.getPipeline(), file, options); }
	getFileReviewState(path: string): ReviewState { return review.getFileReviewState(this, path); }
	setEntryReviewState(entry: FileDateEntry, desired: ReviewState): boolean { return review.setEntryReviewState(this, entry, desired); }
	setFileReviewState(path: string, desired: ReviewState, preserveHidden = false): boolean { return review.setFileReviewState(this, path, desired, preserveHidden); }
	clearFileReviewOverrides(path: string): boolean { return review.clearFileReviewOverrides(this, path); }
	mergeReviewStates(serialized: SerializedEpochIndex): boolean {
		let changed = false;
		for (const [path, data] of Object.entries(this.files)) if (serialized.files[path] && mergeFileReviewStates(data, serialized.files[path])) {
			this.updateAggregatedEntries(path, { skipSort: true }); changed = true;
		}
		if (changed) { this.index = sortIndex(this.index); bumpTimelineSearchIndexVersion(this.plugin as EpochPlugin); }
		return changed;
	}
	getFileMarkColor(path: string): number | null { return updates.getFileMarkColor(this, path); }
	getFileMarkHex(path: string): string { return updates.getFileMarkHex(this, path); }
	cycleFileMarkColor(path: string): boolean { return updates.cycleFileMarkColor(this, path); }
	isFileKnown(path: string): boolean { return updates.isFileKnown(this, path); }
	setFileMarkColor(path: string, color: number | string | null): boolean { return updates.setFileMarkColor(this, path, color); }
	setEntryPinned(target: FileDateEntry, pinned: boolean): boolean { return updates.setEntryPinned(this, target, pinned); }
	isFilePinned(path: string): boolean { return updates.isFilePinned(this, path); }
	setFilePinned(path: string, pinned: boolean): boolean { return updates.setFilePinned(this, path, pinned); }
	getIndexedPaths(): string[] { return updates.getIndexedPaths(this); }
	getFileIndexData(path: string): FileIndexData | null { return updates.getFileIndexData(this, path); }
	removeFile(path: string): void { removeFile(this, path); this.revision++; }
	async renameFile(oldPath: string, newPath: string): Promise<void> { this.revision++; await renameFile(this, oldPath, newPath); }
	private buildFileDateEntry(file: TFile, lines: string[], date: string, isText: boolean, source: DateSource): FileDateEntry {
		return { date, file: file.path, blockStart: 0, blockEnd: Math.max(0, lines.length - 1), summary: resolveSummaryForFile(this.plugin as EpochPlugin, file.path, isText ? lines.join("\n") : "", { includeFileName: false }), source };
	}
	private buildNamedDateEntries(file: TFile, lines: string[], isText: boolean): { anchor: FileDateEntry | null; rangeEntries: FileDateEntry[] } {
		const plugin = this.plugin as EpochPlugin;
		const format = plugin.getDailyNoteFormat?.() || "YYYY-MM-DD";
		const fromFormat = parseDateFromDailyNoteFormat(file.basename, format);
		const dates = fromFormat ? [fromFormat] : parseAnyDates(file.basename);
		if (!dates.length) return { anchor: null, rangeEntries: [] };
		return { anchor: this.buildFileDateEntry(file, lines, dates[0], isText, "namedate"), rangeEntries: dates.slice(1).map(date => ({ ...this.buildFileDateEntry(file, lines, date, isText, "namedate"), namedDateRange: true })) };
	}
	private buildContentDates(file: TFile, lines: string[]): FileDateEntry[] {
		const plugin = this.plugin as EpochPlugin;
		if (resolveFrontmatterSuppressionFlags(plugin, file, lines.slice(0, 250).join("\n")).noparsed) return [];
		const dateKey = getYamlDatePropertyKey(plugin);
		const dateLine = new RegExp(`^${dateKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
		let start = 0;
		if (String(lines[0] ?? "").replace(/^\uFEFF/, "").trim() === "---") {
			for (let i = 1; i < lines.length; i++) if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { start = i + 1; break; }
		}
		const entries: FileDateEntry[] = [];
		const seen = new Set<string>();
		const add = (text: string, line: number, frontmatter: boolean) => {
			for (const date of parseAnyDates(text)) {
				if (frontmatter && seen.has(date)) continue;
				if (frontmatter) seen.add(date);
				entries.push({ date, file: file.path, blockStart: line, blockEnd: line, summary: resolveSummaryForFile(plugin, file.path, stripDatesFromContentSummaryText(text) || text.trim()), source: "content", ...(frontmatter ? { fromFrontmatter: true } : {}) });
			}
		};
		if (plugin.settings.parseDatesInFrontmatter) {
			for (let i = 1; i < start - 1; i++) if (!dateLine.test(lines[i])) add(lines[i], i, true);
			const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm) for (const token of frontmatterToIndexTokens(fm, { excludeKeys: ["repeat", "recur", dateKey.toLowerCase()] })) {
				const keyPath = token.slice(0, token.indexOf(":"));
				if (keyPath.includes(".")) add(token, Math.min(start, Math.max(0, lines.length - 1)), true);
			}
		}
		for (let i = start; i < lines.length; i++) if (lines[i].trim()) add(lines[i], i, false);
		return mergeConsecutiveEntries(plugin, entries, lines);
	}
	private updateAggregatedEntries(path: string, options: { skipSort?: boolean } = {}): void { updateAggregatedEntriesInternal(this.getPipeline(), path, options); this.revision++; }
	private buildMergedDates(data: FileIndexData): FileDateEntry[] {
		const disabled = ((this.plugin as EpochPlugin).settings.summaryWordsCount ?? 0) <= 0;
		return data.contentDates.filter(e => disabled || e.summary.trim() || e.source === "namedate" || e.source === "dateprop").sort((a, b) => a.blockStart - b.blockStart);
	}
	private today(): Date { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
	private readFileContent(file: TFile): Promise<string> {
		const plugin = this.plugin as EpochPlugin;
		try {
			const view = plugin.app.workspace?.getActiveViewOfType?.(MarkdownView);
			if (view?.file?.path === file.path) {
				const value = view.editor?.getValue?.();
				if (typeof value === "string") return Promise.resolve(value);
			}
		} catch { /* An editor may be detached while a file event is handled. */ }
		return plugin.app.vault.read(file);
	}
}
