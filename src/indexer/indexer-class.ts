import { MarkdownView, TFile } from "obsidian";
import {
	DateEntry,
	DateSource,
	EpochIndex,
	FileDateEntry,
	FileIndexData,
	RecurrenceKind,
	SerializedEpochIndex,
	StoredFileIndexData
} from "./types";
import { parseAnyDates } from "./extractor";
import { formatDate, frontmatterToIndexTokens, parseDateFromDailyNoteFormat } from "../utils";
import { sortIndex } from "./indexer-utils";
import { cloneTrackedDates } from "./file-index-factory";
import { resolveSummaryForFile, stripDatesFromContentSummaryText } from "./summary-helpers";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { mergeConsecutiveEntries } from "./content-merger";
import { normalizeSnapshotValue } from "./snapshot-helpers";
import { processFileInternal } from "./process-file";
import { isTrackChangesConfigured } from "../plugin/pro-feature-state";
import { updateAggregatedEntriesInternal } from "./update-aggregated-entries";
import { updateTrackedDatesInternal } from "./update-tracked-dates";
import type { IndexerPipeline } from "./pipeline";
import { MAX_MARK_COLORS } from "../ui/mark-colors";
import { getYamlDatePropertyKey } from "../plugin/frontmatter-keys";
import { normalizeSerializedEpochIndexForDisk } from "./disk-serialization";
import {
	clearFileSummaryState,
	cycleFileMarkColor,
	clearFileReviewOverrides,
	clearEntryAiSummary,
	getFileEmbeddingTerm,
	getFileIndexData,
	getFileMarkColor,
	getIndexedPaths,
	isFileHidden,
	isFileKnown,
	isFilePinned,
	setEntryHidden,
	setEntryReviewState,
	setEntryPinned,
	setFileHidden,
	setFileEmbeddingTerm,
	setFileMarkColor,
	setFilePinned,
	setFileReviewStateForAllRecords,
	setFileReviewStateForAllRecordsPreserveHidden,
	toggleFileVisibility
} from "./entry-updates";
import {
	clearTrackedChanges,
	clearTrackedChangesForPath,
	hasTrackedChanges,
	prepareTrackedBaseline,
	resetTrackedBaseline
} from "./tracked-baseline";
import { removeFile, renameFile } from "./file-ops";

export interface ProcessOptions {
	skipTrackedUpdate?: boolean;
	reason?: "rebuild" | "modify" | "track" | "create" | "open" | "rename";
	previous?: FileIndexData;
	skipSort?: boolean;
}

export class Indexer {
	index: EpochIndex = {};
	private files: Record<string, FileIndexData> = {};
	private latestLines: Record<string, string[]> = {};
	private pipelineCache: IndexerPipeline | null = null;
	private lastSyntheticRefreshTodayKey: string | null = null;

	constructor(private plugin: any) {}

	private getPipeline(): IndexerPipeline {
		if (this.pipelineCache) return this.pipelineCache;
		const getPlugin = () => this.plugin;
		const getIndex = () => this.index;
		const setIndex = (v: EpochIndex) => {
			this.index = v;
		};
		const getFiles = () => this.files;
		const getLatestLines = () => this.latestLines;
		const pipeline: IndexerPipeline = {
			get plugin() {
				return getPlugin();
			},
			get index() {
				return getIndex();
			},
			set index(v) {
				setIndex(v);
			},
			get files() {
				return getFiles();
			},
			get latestLines() {
				return getLatestLines();
			},
			readFileContent: this.readFileContent.bind(this),
			buildFileDateEntry: this.buildFileDateEntry.bind(this),
			buildNamedDateEntries: this.buildNamedDateEntries.bind(this),
			buildContentDates: this.buildContentDates.bind(this),
			updateTrackedDates: this.updateTrackedDates.bind(this),
			updateAggregatedEntries: this.updateAggregatedEntries.bind(this),
			buildMergedDates: this.buildMergedDates.bind(this),
			today: this.today.bind(this),
			isDateBefore: this.isDateBefore.bind(this)
		};
		this.pipelineCache = pipeline;
		return pipeline;
	}

	async load(serialized: SerializedEpochIndex | undefined) {
		if (serialized?.files && serialized?.dates) {
			const normalized: Record<string, FileIndexData> = {};
			for (const [path, data] of Object.entries(serialized.files)) {
				normalized[path] = this.normalizeFileIndexData(data);
			}
			this.files = normalized;
			this.index = sortIndex(serialized.dates);
			const syntheticPaths = new Set<string>();
			for (const [path, data] of Object.entries(this.files)) {
				if (data?.pinnedFile === true) {
					syntheticPaths.add(path);
				}
				if ((data as any)?.recur) {
					syntheticPaths.add(path);
				}
			}
			if (syntheticPaths.size > 0) {
				for (const path of syntheticPaths) {
					this.updateAggregatedEntries(path, { skipSort: true });
				}
				this.index = sortIndex(this.index);
			}
		} else {
			this.files = {};
			this.index = {};
		}
	}

	refreshSyntheticEntries(): void {
		const syntheticPaths: string[] = [];
		for (const [path, data] of Object.entries(this.files ?? {})) {
			if (!data) continue;
			if (data.pinnedFile === true || (data as any)?.recur) {
				syntheticPaths.push(path);
			}
		}
		if (syntheticPaths.length === 0) return;
		for (const path of syntheticPaths) {
			this.updateAggregatedEntries(path, { skipSort: true });
		}
		this.index = sortIndex(this.index);
	}

	refreshSyntheticEntriesIfDayChanged(): boolean {
		const todayKey = formatDate(this.today());
		if (todayKey === this.lastSyntheticRefreshTodayKey) return false;
		this.lastSyntheticRefreshTodayKey = todayKey;
		this.refreshSyntheticEntries();
		return true;
	}

	toJSON(): SerializedEpochIndex {
		return normalizeSerializedEpochIndexForDisk({
			files: this.files,
			dates: sortIndex(this.index)
		});
	}

	async rebuildAll(files: TFile[], onProgress?: (processed: number, total: number) => void) {
		const previousFiles = this.files;
		const previousIndex = this.index;
		const preservedEpochs: Record<string, any[]> = {};
		for (const [date, entries] of Object.entries(previousIndex ?? {})) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const kept = entries.filter(e => {
				if (!e) return false;
				const anyE: any = e as any;
				return String(anyE?.file || "").startsWith("epoch://");
			});
			if (kept.length > 0) {
				preservedEpochs[date] = kept;
			}
		}

		this.files = {};
		this.index = {};
		const total = files.length;
		let processed = 0;
		for (const file of files) {
			try {
				const anyPlugin: any = this.plugin as any;
				const cancelMap: any = anyPlugin?.__epochCancelRequestedAt;
				if (cancelMap && typeof cancelMap === "object" && typeof cancelMap.index === "number" && cancelMap.index > 0) {
					// Restore previous in-memory state so cancel doesn't wipe the index.
					this.files = previousFiles;
					this.index = previousIndex;
					throw Object.assign(new Error("EPOCH_CANCELLED"), { code: "EPOCH_CANCELLED" });
				}
			} catch (e: any) {
				if (String(e?.message || "") === "EPOCH_CANCELLED" || String(e?.code || "") === "EPOCH_CANCELLED") throw e;
				// ignore
			}
			await this.processFile(file, {
				skipTrackedUpdate: true,
				reason: "rebuild",
				previous: previousFiles[file.path],
				skipSort: true
			});
			processed++;
			onProgress?.(processed, total);
		}

		for (const [date, kept] of Object.entries(preservedEpochs)) {
			const current = Array.isArray((this.index as any)[date]) ? (this.index as any)[date] : [];
			const next = current.slice();
			for (const e of kept) {
				const anyE: any = e as any;
				const bucket = String(anyE?.epochBucket || "");
				const start = String(anyE?.epochStart || "");
				const file = String(anyE?.file || "");
				const exists = next.some((x: any) => {
					if (!x) return false;
					if (!String(x?.file || "").startsWith("epoch://")) return false;
					return String(x?.epochBucket || "") === bucket && String(x?.epochStart || "") === start && String(x?.file || "") === file;
				});
				if (!exists) next.push(e);
			}
			(this.index as any)[date] = next;
		}

		this.index = sortIndex(this.index);
	}

	async reprocessAll(files: TFile[], onProgress?: (processed: number, total: number) => void) {
		const total = files.length;
		let processed = 0;
		const seen = new Set<string>();
		for (const file of files) {
			try {
				const anyPlugin: any = this.plugin as any;
				const cancelMap: any = anyPlugin?.__epochCancelRequestedAt;
				if (cancelMap && typeof cancelMap === "object" && typeof cancelMap.index === "number" && cancelMap.index > 0) {
					throw Object.assign(new Error("EPOCH_CANCELLED"), { code: "EPOCH_CANCELLED" });
				}
			} catch (e: any) {
				if (String(e?.message || "") === "EPOCH_CANCELLED" || String(e?.code || "") === "EPOCH_CANCELLED") throw e;
				// ignore
			}
			seen.add(file.path);
			await this.processFile(file, {
				skipTrackedUpdate: true,
				reason: "rebuild",
				skipSort: true
			});
			processed++;
			onProgress?.(processed, total);
		}

		if (seen.size > 0) {
			const knownPaths = Object.keys(this.files);
			for (const path of knownPaths) {
				if (!seen.has(path)) {
					this.removeFile(path);
				}
			}
		}

		this.index = sortIndex(this.index);
	}

	async processFile(file: TFile, options: ProcessOptions = {}) {
		await processFileInternal(this.getPipeline(), file, options);
	}

	public setFileReviewStateForAllRecords(path: string, reviewState: "draft" | "reviewed"): boolean {
		return setFileReviewStateForAllRecords(this, path, reviewState);
	}

	public setFileReviewStateForAllRecordsPreserveHidden(path: string, reviewState: "draft" | "reviewed"): boolean {
		return setFileReviewStateForAllRecordsPreserveHidden(this, path, reviewState);
	}

	public clearFileReviewOverrides(path: string): boolean {
		return clearFileReviewOverrides(this, path);
	}

	public setFileHidden(path: string, hidden: boolean): boolean {
		return setFileHidden(this, path, hidden);
	}

	public isFileHidden(path: string): boolean {
		return isFileHidden(this, path);
	}

	public setEntryHidden(target: DateEntry, hidden: boolean): boolean {
		return setEntryHidden(this, target, hidden);
	}

	public setEntryReviewState(target: DateEntry, reviewState: "draft" | "reviewed"): boolean {
		return setEntryReviewState(this, target, reviewState);
	}

	public toggleFileVisibility(path: string): "hidden" | "visible" | null {
		return toggleFileVisibility(this, path);
	}

	public getFileMarkColor(path: string): number | null {
		return getFileMarkColor(this, path);
	}

	public cycleFileMarkColor(path: string): boolean {
		return cycleFileMarkColor(this, path);
	}

	public clearEntryAiSummary(target: DateEntry): boolean {
		return clearEntryAiSummary(this, target);
	}

	public clearFileSummaryState(path: string): boolean {
		return clearFileSummaryState(this, path);
	}

	public isFileKnown(path: string): boolean {
		return isFileKnown(this, path);
	}

	public setFileMarkColor(path: string, markColor: number | null): boolean {
		return setFileMarkColor(this, path, markColor);
	}

	public setEntryPinned(target: DateEntry, pinned: boolean): boolean {
		return setEntryPinned(this, target, pinned);
	}

	public isFilePinned(path: string): boolean {
		return isFilePinned(this, path);
	}

	public setFilePinned(path: string, pinned: boolean): boolean {
		return setFilePinned(this, path, pinned);
	}

	public getIndexedPaths(): string[] {
		return getIndexedPaths(this);
	}

	public getFileIndexData(path: string): FileIndexData | null {
		return getFileIndexData(this, path);
	}

	public getFileEmbeddingTerm(path: string): string {
		return getFileEmbeddingTerm(this, path);
	}

	public setFileEmbeddingTerm(path: string, term: string): boolean {
		return setFileEmbeddingTerm(this, path, term);
	}

	removeFile(path: string) {
		removeFile(this, path);
	}

	clearTrackedChanges(): boolean {
		return clearTrackedChanges(this);
	}

	clearTrackedChangesForPath(path: string): boolean {
		return clearTrackedChangesForPath(this, path);
	}

	prepareTrackedBaseline(): void {
		prepareTrackedBaseline(this);
	}

	resetTrackedBaseline(): boolean {
		return resetTrackedBaseline(this);
	}

	hasTrackedChanges(): boolean {
		return hasTrackedChanges(this);
	}

	async renameFile(oldPath: string, newPath: string) {
		await renameFile(this, oldPath, newPath);
	}

	private buildFileDateEntry(
		file: TFile,
		lines: string[],
		date: string,
		isText: boolean,
		source: DateSource
	): FileDateEntry {
		const text = isText ? lines.join("\n") : "";
		const baseSummary = resolveSummaryForFile(this.plugin, file.path, text, {
			includeFileName: false
		});
		const summary = baseSummary || "";
		return {
			date,
			file: file.path,
			blockStart: 0,
			blockEnd: Math.max(0, lines.length - 1),
			summary,
			source
		};
	}

	private buildNamedDateEntries(file: TFile, lines: string[], isMd: boolean): { anchor: FileDateEntry | null; rangeEntries: FileDateEntry[] } {
		const pluginAny: any = this.plugin as any;
		const format = typeof pluginAny?.getDailyNoteFormat === "function"
			? String(pluginAny.getDailyNoteFormat() || "").trim()
			: "YYYY-MM-DD";
		const fromFormat = format ? parseDateFromDailyNoteFormat(file.basename, format) : null;
		if (fromFormat) {
			return { anchor: this.buildFileDateEntry(file, lines, fromFormat, isMd, "namedate"), rangeEntries: [] };
		}
		const parsed = parseAnyDates(file.basename);
		if (parsed.length === 0) return { anchor: null, rangeEntries: [] };
		if (parsed.length === 1) {
			return { anchor: this.buildFileDateEntry(file, lines, parsed[0]!, isMd, "namedate"), rangeEntries: [] };
		}
		// Filename date range: use the first (fromDate) as the anchor.
		// The rest remain as range entries so the note appears on all range days.
		const anchor = this.buildFileDateEntry(file, lines, parsed[0]!, isMd, "namedate");
		const rangeEntries = parsed.slice(1).map(d => {
			const entry = this.buildFileDateEntry(file, lines, d, isMd, "namedate");
			(entry as any).namedDateRange = true;
			return entry;
		});
		return { anchor, rangeEntries };
	}

	private buildContentDates(file: TFile, lines: string[]): FileDateEntry[] {
		const parseDatesInFrontmatter = (this.plugin as any)?.settings?.parseDatesInFrontmatter === true;
		const datePropertyKey = getYamlDatePropertyKey(this.plugin);
		const datePropertyLineRe = new RegExp(`^${datePropertyKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
		const datePropertyKeyLower = String(datePropertyKey).toLowerCase();
		try {
			const rawText = Array.isArray(lines) && lines.length > 0 ? lines.slice(0, 250).join("\n") : "";
			const suppression = resolveFrontmatterSuppressionFlags(this.plugin, file, rawText);
			if (suppression.noparsed) return [];
		} catch {
			// ignore
		}
		const entries: FileDateEntry[] = [];
		const frontmatterSeen = new Set<string>();
		const scanStart = (() => {
			if (!Array.isArray(lines) || lines.length === 0) return 0;
			const firstRaw = String(lines[0] ?? "");
			const first = firstRaw.replace(/^\uFEFF/, "").trim();
			if (first !== "---") return 0;
			for (let i = 1; i < lines.length; i++) {
				const trimmed = String(lines[i] ?? "").trim();
				if (trimmed === "---" || trimmed === "...") {
					return i + 1;
				}
			}
			return 0;
		})();

		const pickAnchorLine = (): number => {
			if (!Array.isArray(lines) || lines.length === 0) return 0;
			const start = Math.max(0, Math.min(scanStart, lines.length - 1));
			for (let i = start; i < lines.length; i++) {
				if (String(lines[i] ?? "").trim()) return i;
			}
			if (scanStart > 0) {
				const end = Math.max(1, Math.min(scanStart - 1, lines.length));
				for (let i = end - 1; i >= 1; i--) {
					if (String(lines[i] ?? "").trim()) return i;
				}
			}
			return start;
		};

		const addFrontmatterTokenDates = (token: string, preferredLineIndex?: number) => {
			const dates = parseAnyDates(token);
			if (dates.length === 0) return;
			const anchorLine = (() => {
				if (typeof preferredLineIndex === "number" && Number.isFinite(preferredLineIndex)) {
					const idx = Math.max(0, Math.min(lines.length - 1, Math.floor(preferredLineIndex)));
					if (String(lines[idx] ?? "").trim()) return idx;
				}
				return pickAnchorLine();
			})();
			for (const date of dates) {
				if (frontmatterSeen.has(date)) continue;
				frontmatterSeen.add(date);
				const raw = String(lines[anchorLine] ?? "");
				const summaryText = stripDatesFromContentSummaryText(raw);
				entries.push({
					date,
					file: file.path,
					blockStart: anchorLine,
					blockEnd: anchorLine,
					summary: resolveSummaryForFile(this.plugin, file.path, summaryText),
					source: "content",
					fromFrontmatter: true
				});
			}
		};

		if (parseDatesInFrontmatter && scanStart > 0) {
			const end = Math.max(1, Math.min(scanStart - 1, lines.length));
			for (let i = 1; i < end; i++) {
				const line = String(lines[i] ?? "");
				if (!line.trim()) continue;
				// Do not index the configured anchor frontmatter date key as a parsed/content date.
				// Other YAML keys may still emit frontmatter-derived parsed/content dates.
				if (datePropertyLineRe.test(line)) continue;
				addFrontmatterTokenDates(line, i);
			}
		}

		// Include dates found in YAML frontmatter (via Obsidian metadata cache).
		if (parseDatesInFrontmatter) {
			try {
				const pluginAny: any = this.plugin as any;
				const cache = pluginAny?.app?.metadataCache?.getFileCache?.(file);
				const fm: any = cache?.frontmatter ?? null;
				if (fm && typeof fm === "object") {
					const tokens = frontmatterToIndexTokens(fm, {
						excludeKeys: ["repeat", "recur", datePropertyKeyLower]
					});
					if (tokens.length > 0) {
						for (const tok of tokens) {
							const raw = String(tok ?? "");
							const sep = raw.indexOf(":");
							const keyPath = sep >= 0 ? raw.slice(0, sep).trim() : "";
							// Raw YAML line scanning already covers top-level scalar keys.
							// Restrict metadata-cache fallback token parsing to nested paths,
							// which avoids cache-normalized date values introducing phantom dates.
							if (!keyPath || !keyPath.includes(".")) continue;
							addFrontmatterTokenDates(raw);
						}
					}
				}
			} catch {
				// ignore
			}
		}

		for (let i = scanStart; i < lines.length; i++) {
			const rawLine = lines[i] ?? "";
			const trimmed = rawLine.trim();
			if (!trimmed) continue;
			const dates = parseAnyDates(rawLine);
			if (dates.length === 0) continue;
			const summaryText = stripDatesFromContentSummaryText(rawLine) || trimmed;
			for (const date of dates) {
				entries.push({
					date,
					file: file.path,
					blockStart: i,
					blockEnd: i,
					summary: resolveSummaryForFile(this.plugin, file.path, summaryText),
					source: "content"
				});
			}
		}

		return mergeConsecutiveEntries(this.plugin, entries, lines);
	}

	private updateTrackedDates(file: TFile, data: FileIndexData, lines: string[]) {
		updateTrackedDatesInternal(this.getPipeline(), file, data, lines);
	}

	private isDateBefore(a: string | null | undefined, b: string | null | undefined): boolean {
		if (!a || !b) return false;
		return a < b;
	}

	private updateAggregatedEntries(filePath: string, options: { skipSort?: boolean } = {}) {
		updateAggregatedEntriesInternal(this.getPipeline(), filePath, options);
	}

	private normalizeFileIndexData(data: StoredFileIndexData): FileIndexData {
		const recurReviewedDates = (() => {
			try {
				const raw: any = (data as any)?.recurReviewedDates;
				if (!Array.isArray(raw)) return [];
				const out: string[] = [];
				for (const v of raw) {
					const s = String(v || "").trim();
					if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
					out.push(s);
				}
				return out;
			} catch {
				return [];
			}
		})();
		const contentHashRaw = typeof (data as any)?.contentHash === "string" ? String((data as any).contentHash) : "";
		const contentHash = contentHashRaw.trim() ? contentHashRaw : undefined;

		const embeddingTermRaw = typeof (data as any)?.embeddingTerm === "string" ? String((data as any).embeddingTerm) : "";
		const embeddingTerm = embeddingTermRaw.trim();
		const tracked = cloneTrackedDates(data.trackedDates);
		const cdate = data.cdate ?? null;
		const namedDate = data.namedDate ?? null;
		const dateProp = data.dateProp ?? null;
		const content = Array.isArray(data.contentDates)
			? data.contentDates.map(entry => ({ ...entry }))
			: [];
		const trackedSnapshot = normalizeSnapshotValue(
			typeof data.trackedSnapshot === "string" ? data.trackedSnapshot : null
		);
		const trackedSnapshotDate =
			typeof data.trackedSnapshotDate === "string" ? data.trackedSnapshotDate : null;
		const trackedBaselineSnapshot = normalizeSnapshotValue(
			typeof data.trackedBaselineSnapshot === "string" ? data.trackedBaselineSnapshot : null
		);
		const trackedBaselineDate = typeof data.trackedBaselineDate === "string" ? data.trackedBaselineDate : null;
		const markColorRaw = typeof (data as any)?.markColor === "number" ? (data as any).markColor : null;
		const markColor = markColorRaw != null
			? Math.max(1, Math.min(MAX_MARK_COLORS, Math.floor(markColorRaw)))
			: undefined;
		const pinnedFile = data.pinnedFile === true;
		const noparsed = (data as any)?.noparsed === true;
		const notracked = (data as any)?.notracked === true;
		const recurHiddenDates = (() => {
			try {
				const raw: any = (data as any)?.recurHiddenDates;
				if (!Array.isArray(raw)) return [];
				const out: string[] = [];
				for (const v of raw) {
					const s = String(v || "").trim();
					if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
					out.push(s);
				}
				return out;
			} catch {
				return [];
			}
		})();
		const recur = (() => {
			const raw: any = (data as any)?.recur;
			if (!raw || typeof raw !== "object") return null;
			const r = String(raw?.raw ?? "").trim();
			const rule = String(raw?.rrule ?? "").trim();
			const kindRaw = String(raw?.kind ?? "");
			const kind = (kindRaw === "rrule" || kindRaw === "friendly" ? kindRaw : "friendly") as RecurrenceKind;
			const lineRaw = Number(raw?.line ?? 0);
			const line = Number.isFinite(lineRaw) ? Math.max(0, Math.floor(lineRaw)) : 0;
			const from = typeof raw?.from === "string" ? String(raw.from) : undefined;
			const until = typeof raw?.until === "string" ? String(raw.until) : undefined;
			const countRaw = Number(raw?.count ?? NaN);
			const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : undefined;
			if (!r || !rule) return null;
			return { raw: r, rrule: rule, kind, line, from, until, count };
		})();
		const indexedMtimeMsRaw = Number((data as any)?.indexedMtimeMs);
		const indexedMtimeMs = Number.isFinite(indexedMtimeMsRaw) && indexedMtimeMsRaw > 0
			? indexedMtimeMsRaw
			: undefined;
		const indexedSizeRaw = Number((data as any)?.indexedSize);
		const indexedSize = Number.isFinite(indexedSizeRaw) && indexedSizeRaw >= 0
			? indexedSizeRaw
			: undefined;
		return {
			cdate: cdate ? { ...cdate } : null,
			namedDate: namedDate ? { ...namedDate } : null,
			dateProp: dateProp ? { ...dateProp } : null,
			contentDates: content,
			noparsed,
			trackedDates: tracked,
			notracked,
			trackedSnapshot,
			trackedSnapshotDate,
			trackedBaselineSnapshot,
			trackedBaselineDate,
			indexedMtimeMs,
			indexedSize,
			contentHash,
			embeddingTerm: embeddingTerm || undefined,
			markColor,
			pinnedFile,
			recur,
			recurHiddenDates,
			recurReviewedDates
		};
	}

	private buildMergedDates(data: FileIndexData): FileDateEntry[] {
		const content = data.contentDates ?? [];
		const tracked: FileDateEntry[] = [];
		const summaryWords = Math.max(0, (this.plugin as any)?.settings?.summaryWordsCount ?? 0);
		const summaryDisabled = summaryWords <= 0;
		if (isTrackChangesConfigured(this.plugin)) {
			for (const dateKey of Object.keys(data.trackedDates)) {
				tracked.push(...data.trackedDates[dateKey]);
			}
		}

		const combined = [...content, ...tracked].filter(entry => {
			if (summaryDisabled && entry.source === "content") return true;
			const trimmed = (entry.summary || "").trim();
			if (trimmed.length > 0) return true;
			return entry.source === "tracked" || entry.source === "namedate" || entry.source === "dateprop";
		});

		return combined.sort((a, b) => a.blockStart - b.blockStart);
	}

	private today(): Date {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d;
	}

	private async readFileContent(file: TFile, reason?: ProcessOptions["reason"]): Promise<string> {
		if (reason === "track" || reason === "modify") {
			const view = this.plugin.app.workspace.getActiveViewOfType?.(MarkdownView);
			if (view?.file?.path === file.path) {
				try {
					const live = view.editor?.getValue?.();
					if (typeof live === "string") return live;
				} catch (err) {
					void err;
				}
			}
		}
		return this.plugin.app.vault.read(file);
	}
}
