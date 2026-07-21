import type { TFile } from "obsidian";
import type { ProcessOptions } from "./indexer";
import type { FileIndexData } from "./types";
import { cloneTrackedDates, createEmptyFileIndex } from "./file-index-factory";
import { normalizeDateFromTimestamp, parseAnyDate } from "./extractor";
import { applyEntryState } from "./entry-state";
import { normalizeSnapshotValue } from "./snapshot-helpers";
import { computeTextHash, frontmatterToIndexTokens, isLikelyTextFileExtension, stripYamlFrontmatterBlock } from "../utils";
import type { IndexerPipeline } from "./pipeline";
import { removeEntriesForFile } from "./indexer-utils";
import { markTimelineSearchIndexDirty, scheduleTimelineSearchCacheSave } from "../plugin/timeline-search-cache";
import { parseRecurrenceFrontmatter } from "./recurrence";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { isTrackChangesConfigured } from "../plugin/pro-feature-state";
import { isTopicSimilarityEnabled } from "../plugin/similarity/config";
import {
	buildFrontmatterPropertyLineRegex,
	getYamlDatePropertyKey,
} from "../plugin/frontmatter-keys";
import { consumeNoteFrontmatterWritePath, readYamlPropertyFromText } from "../plugin/note-frontmatter";
import { findMarkColorIndexForCss } from "../ui/mark-colors";

function isDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

type TimelineSearchRecord = {
	id: string;
	kind: string;
	path: string;
	basename: string;
	directory: string;
	content: string;
	meta: string;
};

type TimelineSearchIndexLike = {
	removeById?: (path: string) => boolean;
	upsert?: (record: TimelineSearchRecord) => boolean;
};

type ProcessFilePluginLike = {
	settings?: { anchorMdate?: boolean; similarityZeroShotMinScore?: number };
	timelineSearchIndex?: TimelineSearchIndexLike;
	indexer?: { getFileEmbeddingTerm?: (path: string) => string };
	termSimilarityLoaded?: boolean;
	termSimilarityIndex?: { files?: Record<string, { term?: string; score?: number }> };
	app?: { metadataCache?: { getFileCache?: (file: TFile) => FileCacheLike | null }, workspace?: { containerEl?: HTMLElement } };
};

type FileCacheLike = {
	tags?: Array<{ tag?: string }>;
	frontmatter?: Record<string, unknown>;
};

function collectDates(data: FileIndexData | null | undefined): string[] {
	const out = new Set<string>();
	if (!data) return [];
	const add = (d: unknown) => {
		const v = typeof d === "string" ? d : "";
		if (isDateKey(v)) out.add(v);
	};
	const getDateValue = (entry: unknown): string | null => {
		if (!entry || typeof entry !== "object") return null;
		const date = (entry as { date?: unknown }).date;
		return typeof date === "string" ? date : null;
	};
	add(data.cdate?.date);
	add(data.namedDate?.date);
	add(data.dateProp?.date);
	for (const e of data.contentDates ?? []) add(getDateValue(e));
	for (const k of Object.keys(data.trackedDates ?? {})) add(k);
	return Array.from(out);
}

function removeFileFromIndexingPipeline(s: IndexerPipeline, path: string, previous: FileIndexData | null | undefined): void {
	let timelineMutated = false;
	try {
		const timelineSearchIndex = (s.plugin as unknown as ProcessFilePluginLike).timelineSearchIndex;
		timelineMutated = timelineSearchIndex?.removeById?.(path) === true;
	} catch {
		// ignore
	}
	if (timelineMutated) {
		try {
			markTimelineSearchIndexDirty(s.plugin);
		} catch {
			// ignore
		}
		try {
			scheduleTimelineSearchCacheSave(s.plugin);
		} catch {
			// ignore
		}
	}

	const affectedDates = collectDates(previous);
	delete s.files[path];
	removeEntriesForFile(s.index, path);
	delete s.latestLines[path];

	if (affectedDates.length > 0 && typeof s.plugin?.enqueueEpochsForDateKeys === "function") {
		try {
			void s.plugin.enqueueEpochsForDateKeys(affectedDates, { force: false, showNotice: false });
		} catch {
			// ignore
		}
	}
}

export async function processFileInternal(
	s: IndexerPipeline,
	file: TFile,
	options: ProcessOptions = {}
): Promise<void> {
	const isMd = file.extension === "md";
	const isEpochgramExportHtml = (() => {
		try {
			const ext = String(file.extension || "").toLowerCase();
			if (ext !== "html" && ext !== "htm") return false;
			const base = String(file.basename || "").toLowerCase();
			return base.startsWith("epochgram-");
		} catch {
			return false;
		}
	})();
	const isText = isLikelyTextFileExtension(file.extension) && !isEpochgramExportHtml;

	const previousData = options.previous ?? s.files[file.path] ?? createEmptyFileIndex();

	const rawContent = isText ? await s.readFileContent(file, options.reason) : "";
	const normalizedContent = isText ? (normalizeSnapshotValue(rawContent) ?? "") : "";
	const suppression = resolveFrontmatterSuppressionFlags(s.plugin, file, normalizedContent);
	if (suppression.noindex) {
		removeFileFromIndexingPipeline(s, file.path, previousData);
		return;
	}
	const contentHash = isText ? computeTextHash(normalizedContent) : undefined;
	const previousContentHash = typeof previousData.contentHash === "string" ? String(previousData.contentHash) : null;
	const previousSnapshot = typeof previousData.trackedSnapshot === "string" ? normalizeSnapshotValue(previousData.trackedSnapshot) : null;
	const frontmatterWrite = consumeNoteFrontmatterWritePath(s.plugin, file.path);
	const bodySnapshot = isText ? (normalizeSnapshotValue(stripYamlFrontmatterBlock(normalizedContent)) ?? "") : "";
	const frontmatterOnlyChange = isText && previousSnapshot != null && previousSnapshot === bodySnapshot;
	const contentUnchanged = isText && (
		(previousContentHash != null && previousContentHash === contentHash) ||
		(previousContentHash == null && previousSnapshot != null && previousSnapshot === normalizedContent)
	);
	const fileData: FileIndexData = {
		cdate: null,
		namedDate: null,
		dateProp: null,
		contentDates: [],
		noparsed: suppression.noparsed,
		recur: null,
		recurHiddenDates: Array.isArray(previousData.recurHiddenDates) ? [...previousData.recurHiddenDates] : [],
		trackedDates: cloneTrackedDates(previousData.trackedDates),
		notracked: suppression.notracked,
		trackedSnapshot: previousData.trackedSnapshot ?? null,
		trackedSnapshotDate: previousData.trackedSnapshotDate ?? null,
		trackedBaselineSnapshot: previousData.trackedBaselineSnapshot ?? null,
		trackedBaselineDate: previousData.trackedBaselineDate ?? null,
		indexedMtimeMs: (() => {
			const v = Number(file.stat?.mtime);
			return Number.isFinite(v) && v > 0 ? v : undefined;
		})(),
		indexedSize: (() => {
			const v = Number(file.stat?.size);
			return Number.isFinite(v) && v >= 0 ? v : undefined;
		})(),
		contentHash
	};
	const useAnchorMdate = (s.plugin as unknown as ProcessFilePluginLike).settings?.anchorMdate === true;
	const fileDataRuntime = fileData as FileIndexData & { __pendingTrackedReviewStateClear?: boolean };

	// Reset tracked-entry review state for the tracked bucket day when the file
	// meaningfully changes. (Hidden stays separate and is preserved.)
	if (options.reason === "create") {
		fileDataRuntime.__pendingTrackedReviewStateClear = true;
	} else if (options.reason === "modify" || options.reason === "track") {
		if (!contentUnchanged && !frontmatterWrite && !frontmatterOnlyChange) {
			fileDataRuntime.__pendingTrackedReviewStateClear = true;
		}
	}

	const rawLines = isText ? rawContent.split(/\r?\n/) : [];
	const lines = isText ? rawLines : [];
	const explicitPinRaw = isText ? readYamlPropertyFromText(rawContent, "pin") : "";
	const explicitMarkRaw = isText ? readYamlPropertyFromText(rawContent, "mark") : "";
	const explicitMarkHex = String(explicitMarkRaw || "").trim();
	// Avoid keeping all file contents in memory across a whole vault.
	// We only populate latestLines temporarily so aggregated entries can compute summaries,
	// then drop it unless this is an on-demand operation.
	if (isText) {
		s.latestLines[file.path] = lines;
	} else {
		delete s.latestLines[file.path];
	}
	const ctime = Number(file.stat?.ctime);
	const mtime = Number(file.stat?.mtime);
	const anchorTimestamp =
		useAnchorMdate && Number.isFinite(mtime) && mtime > 0
			? mtime
			: Number.isFinite(ctime) && ctime > 0
				? ctime
				: mtime;
	fileData.cdate = s.buildFileDateEntry(
		file,
		lines,
		normalizeDateFromTimestamp(anchorTimestamp),
		isText,
		"cdate"
	);
	fileData.anchorUsesMdate = useAnchorMdate;
	if (String(explicitPinRaw || "").trim() || /(^|\n)\s*pin\s*:/i.test(rawContent)) {
		fileData.pinnedFile = true;
	}
	if (explicitMarkHex) {
		fileData.markColorHex = explicitMarkHex;
		try {
			const root = (s.plugin as unknown as { app?: { workspace?: { containerEl?: HTMLElement } } }).app?.workspace?.containerEl ?? null;
			const markIndex = findMarkColorIndexForCss(explicitMarkHex, root ?? null);
			fileData.markColor = markIndex ?? undefined;
		} catch {
			fileData.markColor = undefined;
		}
	}
	let recurLine = 0;
	let recurValue: string | null = null;
	try {
		const datePropertyKey = getYamlDatePropertyKey(s.plugin);
		const dateLineRegex = buildFrontmatterPropertyLineRegex(datePropertyKey);
		let key: string | null = null;
		const firstLine = String(rawLines[0] ?? "").replace(/^\uFEFF/, "").trim();
		if (firstLine === "---") {
			for (let i = 1; i < rawLines.length; i++) {
				const line = String(rawLines[i] ?? "");
				const trimmed = line.trim();
				if (trimmed === "---" || trimmed === "...") break;

				if (!key) {
					const m = line.match(dateLineRegex);
					if (m) {
						const value = String(m[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
						if (value) key = parseAnyDate(value);
					}
				}

				if (!recurValue) {
					const m = line.match(/^\s*(repeat|recur)\s*:\s*(.+?)\s*$/i);
					if (m) {
						recurLine = i;
						const value = String(m[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
						recurValue = value ? value : null;
					}
				}
			}
		}
		if (key && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
			fileData.dateProp = s.buildFileDateEntry(file, lines, key, isText, "dateprop");
		}
	} catch {
		// ignore
	}

	const named = s.buildNamedDateEntries(file, lines, isText);
	fileData.namedDate = named.anchor;

	// Parse `repeat:` once anchor candidates are available.
	try {
		const fallbackStart = (() => {
			const nd = fileData.namedDate?.date;
			const dp = fileData.dateProp?.date;
			const cd = fileData.cdate?.date;
			return typeof nd === "string" && nd
				? nd
				: typeof dp === "string" && dp
					? dp
					: typeof cd === "string" && cd
						? cd
						: null;
		})();
		fileData.recur = parseRecurrenceFrontmatter({ rawValue: recurValue, line: recurLine, fallbackStartDateKey: fallbackStart });
	} catch {
		fileData.recur = null;
	}

	if (isText) {
		if (!suppression.noparsed) {
			const content = s.buildContentDates(file, lines);
			fileData.contentDates = named.rangeEntries.length > 0 ? [...named.rangeEntries, ...content] : content;
		} else {
			fileData.contentDates = named.rangeEntries.length > 0 ? [...named.rangeEntries] : [];
		}
	} else {
		fileData.contentDates = named.rangeEntries.length > 0 ? [...named.rangeEntries] : [];
	}

	if (suppression.notracked) {
		fileData.trackedDates = {};
	} else if (isTrackChangesConfigured(s.plugin) && isMd && !options.skipTrackedUpdate) {
		s.updateTrackedDates(file, fileData, lines);
	}

	if (!isMd) {
		fileData.trackedDates = {};
		fileData.trackedSnapshot = null;
		fileData.trackedSnapshotDate = null;
		fileData.trackedBaselineSnapshot = null;
		fileData.trackedBaselineDate = null;
	}

	applyEntryState(previousData, fileData);

	// Preserve cdate when the file was already indexed. cdate is derived from
	// file.stat.ctime which is device-specific after sync (mobile gets the sync
	// timestamp, desktop keeps the original). Re-computing it would cause
	// cross-device index divergence even when the file hasn't changed.
	const previousAnchorUsesMdate = (previousData as FileIndexData & { anchorUsesMdate?: boolean }).anchorUsesMdate === true;
	if (
		previousData.cdate !== null &&
		previousData.cdate !== undefined &&
		previousAnchorUsesMdate === useAnchorMdate
	) {
		fileData.cdate = previousData.cdate;
	}

	// When content is unchanged, also preserve the other parsed date fields to
	// avoid spurious diff from ctime/metadata-cache timing differences.
	if (contentUnchanged && options.reason !== "rename") {
		fileData.namedDate = previousData.namedDate ?? null;
		fileData.dateProp = previousData.dateProp ?? null;
		fileData.contentDates = previousData.contentDates ?? [];
		fileData.recur = previousData.recur ?? null;
	}

	const shouldResetReviewedOnEdit =
		(options.reason === "create" || options.reason === "modify" || options.reason === "track") &&
		!contentUnchanged &&
		!frontmatterWrite &&
		!frontmatterOnlyChange &&
		previousData.pinnedFile !== true;
	if (shouldResetReviewedOnEdit) {
		const clearReviewed = (entry: FileIndexData["cdate"]): void => {
			if (!entry) return;
			if (entry.reviewState === "reviewed") delete entry.reviewState;
		};
		clearReviewed(fileData.cdate);
		clearReviewed(fileData.namedDate);
		clearReviewed(fileData.dateProp);
		for (const entry of fileData.contentDates) {
			if (entry?.reviewState === "reviewed") delete entry.reviewState;
		}
		fileData.recurReviewedDates = [];
	}

	s.files[file.path] = fileData;
	// MiniSearch: index file for timeline search.
	try {
		const pluginRuntime = s.plugin as unknown as ProcessFilePluginLike;
		const timelineSearchIndex = pluginRuntime.timelineSearchIndex;
		if (timelineSearchIndex && typeof timelineSearchIndex.upsert === "function") {
			const directory = (() => {
				try {
					const p = typeof file.parent?.path === "string" ? String(file.parent.path) : "";
					return p;
				} catch {
					return "";
				}
			})();
			const basename = String(file.basename || "");
			const metaParts: string[] = [];
			metaParts.push(`ext:${String(file.extension || "")}`);
			try {
				const mc = Number(fileData.markColor ?? NaN);
				if (Number.isFinite(mc)) metaParts.push(`mark:${String(Math.floor(mc))}`);
			} catch {
				// ignore
			}
			try {
				if (fileData.pinnedFile === true) metaParts.push("pinned");
			} catch {
				// ignore
			}
			try {
				const getFileEmbeddingTerm = pluginRuntime.indexer?.getFileEmbeddingTerm;
				const term = typeof getFileEmbeddingTerm === "function" ? String(getFileEmbeddingTerm(file.path) || "") : "";
				if (term) metaParts.push(term);
			} catch {
				// ignore
			}
			try {
				if (isTopicSimilarityEnabled(s.plugin)) {
					const zeroShotMinRaw = Number(pluginRuntime.settings?.similarityZeroShotMinScore ?? 0);
					const zeroShotMin = Number.isFinite(zeroShotMinRaw) ? Math.max(0, Math.min(1, zeroShotMinRaw)) : 0;
					const storeLoaded = pluginRuntime.termSimilarityLoaded === true && !!pluginRuntime.termSimilarityIndex && typeof pluginRuntime.termSimilarityIndex === "object";
					if (storeLoaded && zeroShotMin > 0 && zeroShotMin < 1) {
						const rec = pluginRuntime.termSimilarityIndex?.files?.[file.path];
						const inferred = typeof rec?.term === "string" ? String(rec.term).trim() : "";
						const score = Number(rec?.score ?? 0);
						if (inferred && Number.isFinite(score) && score >= zeroShotMin) {
							metaParts.push(inferred);
						}
					}
				}
			} catch {
				// ignore
			}
			try {
				const cache = pluginRuntime.app?.metadataCache?.getFileCache?.(file);
				const tags: string[] = [];
				const aliases: string[] = [];
				const addTag = (t: unknown) => {
					const v = typeof t === "string" ? t.trim() : "";
					if (v) tags.push(v);
				};
				const addAlias = (a: unknown) => {
					const v = typeof a === "string" ? a.trim() : "";
					if (v) aliases.push(v);
				};
				for (const t of cache?.tags ?? []) addTag(t?.tag);
				const fm = cache?.frontmatter ?? null;
				if (fm) {
					const fmTags = fm.tags;
					if (typeof fmTags === "string") {
						for (const seg of fmTags.split(/[,\n]/g)) addTag(seg);
					} else if (Array.isArray(fmTags)) {
						for (const seg of fmTags) addTag(seg);
					}
					const fmAliases = fm.aliases;
					if (typeof fmAliases === "string") {
						for (const seg of fmAliases.split(/[,\n]/g)) addAlias(seg);
					} else if (Array.isArray(fmAliases)) {
						for (const seg of fmAliases) addAlias(seg);
					}
					for (const tok of frontmatterToIndexTokens(fm)) metaParts.push(tok);
				}
				for (const t of Array.from(new Set(tags))) metaParts.push(t);
				for (const a of Array.from(new Set(aliases))) metaParts.push(a);
			} catch {
				// ignore
			}
			const timelineMutated = timelineSearchIndex.upsert({
				id: file.path,
				kind: "file",
				path: file.path,
				basename,
				directory,
				content: stripYamlFrontmatterBlock(normalizedContent),
				meta: metaParts.join("\n")
			});
			if (timelineMutated) {
				try {
					markTimelineSearchIndexDirty(s.plugin);
				} catch {
					// ignore
				}
				try {
					scheduleTimelineSearchCacheSave(s.plugin);
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}
	s.updateAggregatedEntries(file.path, { skipSort: options.skipSort === true });
	// Drop cached lines after aggregation to prevent runaway memory usage.
	if (isText) {
		const reason = options.reason;
		const shouldKeep = reason === "track" || reason === "open";
		if (!shouldKeep) {
			delete s.latestLines[file.path];
		} else {
			// Keep only a small prefix to bound memory on huge notes.
			const MAX_KEEP_LINES = 2000;
			if (lines.length > MAX_KEEP_LINES) {
				s.latestLines[file.path] = lines.slice(0, MAX_KEEP_LINES);
			}
		}
	}
	const shouldEnqueueAi =
		options.reason === "modify" ||
		options.reason === "create" ||
		options.reason === "track";
	if (shouldEnqueueAi && typeof s.plugin?.enqueueAiSummariesForFile === "function") {
		try {
			// run in background; do not block indexing
			void s.plugin.enqueueAiSummariesForFile(file.path);
		} catch {
			// ignore
		}
	}

	if (shouldEnqueueAi && typeof s.plugin?.enqueueEpochsForDateKeys === "function") {
		try {
			const touched = new Set<string>();
			for (const d of collectDates(previousData)) touched.add(d);
			for (const d of collectDates(fileData)) touched.add(d);
			if (touched.size > 0) {
				void s.plugin.enqueueEpochsForDateKeys(Array.from(touched), { force: false, showNotice: false });
			}
		} catch {
			// ignore
		}
	}
}
