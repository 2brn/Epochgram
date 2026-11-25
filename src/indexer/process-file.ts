import type { TFile } from "obsidian";
import type { ProcessOptions } from "./indexer";
import { normalizePinMode, type FileIndexData } from "./types";
import { createEmptyFileIndex } from "./file-index-factory";
import { normalizeDateFromTimestamp, parseAnyDate } from "./extractor";
import { applyEntryState } from "./entry-state";
import { resetReviewedAnchors } from "./review-state";
import { normalizeSnapshotValue } from "./snapshot-helpers";
import { computeTextHash, frontmatterToIndexTokens, isLikelyTextFilePath, stripYamlFrontmatterBlock } from "../utils";
import type { IndexerPipeline } from "./pipeline";
import { markTimelineSearchIndexDirty, scheduleTimelineSearchCacheSave } from "../plugin/timeline-search-cache";
import { parseRecurrenceFrontmatter } from "./recurrence";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { buildFrontmatterPropertyLineRegex, getYamlDatePropertyKey } from "../plugin/frontmatter-keys";
import { readYamlPropertyFromText } from "../plugin/note-frontmatter";
import { findMarkColorIndexForCss } from "../ui/mark-colors";

function normalizeYamlMarkHex(value: unknown): string {
	const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
	const hex = raw.startsWith("#") ? raw : `#${raw}`;
	return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? hex.toLowerCase() : "";
}

export async function processFileInternal(s: IndexerPipeline, file: TFile, options: ProcessOptions = {}): Promise<void> {
	const isText = isLikelyTextFilePath(file.path);
	const rawContent = isText ? await s.readFileContent(file, options.reason) : "";
	const previous = options.previous ?? s.files[file.path] ?? createEmptyFileIndex();
	const normalized = normalizeSnapshotValue(rawContent) ?? "";
	const suppression = resolveFrontmatterSuppressionFlags(s.plugin, file, normalized);
	if (suppression.noindex) {
		if (s.plugin.timelineSearchIndex?.removeById?.(file.path)) { markTimelineSearchIndexDirty(s.plugin); scheduleTimelineSearchCacheSave(s.plugin); }
		delete s.files[file.path]; delete s.latestLines[file.path];
		s.updateAggregatedEntries(file.path, { skipSort: options.skipSort });
		return;
	}
	const contentHash = isText ? computeTextHash(normalized) : undefined;
	const bodyHash = isText ? computeTextHash(stripYamlFrontmatterBlock(normalized)) : undefined;
	const data: FileIndexData = {
		...createEmptyFileIndex(), noparsed: suppression.noparsed, recur: null,
		indexedMtimeMs: file.stat?.mtime, indexedSize: file.stat?.size, contentHash, bodyHash
	};
	const lines = isText ? rawContent.split(/\r?\n/) : [];
	if (isText) s.latestLines[file.path] = lines;
	else delete s.latestLines[file.path];
	const useMdate = s.plugin.settings?.anchorMdate === true;
	const ctime = Number(file.stat?.ctime), mtime = Number(file.stat?.mtime);
	const timestamp = useMdate && Number.isFinite(mtime) && mtime > 0 ? mtime : Number.isFinite(ctime) && ctime > 0 ? ctime : mtime;
	data.cdate = s.buildFileDateEntry(file, lines, normalizeDateFromTimestamp(timestamp), isText, "cdate");
	data.anchorUsesMdate = useMdate;
	data.pinnedFile = normalizePinMode(isText ? readYamlPropertyFromText(rawContent, "pin") : null);
	if (isText) {
		const hex = normalizeYamlMarkHex(readYamlPropertyFromText(rawContent, "mark"));
		data.markColorHex = hex;
		data.markColor = hex ? findMarkColorIndexForCss(hex, s.plugin.app?.workspace?.containerEl ?? null) ?? undefined : undefined;
	}
	let recurValue: string | null = null, recurLine = 0, dateKey: string | null = null;
	let icsSynced = false;
	const dateRegex = buildFrontmatterPropertyLineRegex(getYamlDatePropertyKey(s.plugin));
	if (String(lines[0] ?? "").replace(/^\uFEFF/, "").trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) break;
			const dateMatch = line.match(dateRegex);
			if (!dateKey && dateMatch) dateKey = parseAnyDate(dateMatch[1].trim().replace(/^['"]|['"]$/g, ""));
			const recurMatch = line.match(/^\s*(repeat|recur)\s*:\s*(.+?)\s*$/i);
			if (!recurValue && recurMatch) { recurLine = i; recurValue = recurMatch[2].trim().replace(/^['"]|['"]$/g, ""); }
			if (/^\s*syncKey\s*:\s*\S/.test(line)) icsSynced = true;
		}
	}
	if (dateKey) {
		data.dateProp = s.buildFileDateEntry(file, lines, dateKey, isText, "dateprop");
		if (icsSynced) data.dateProp.icsSynced = true;
	}
	const named = s.buildNamedDateEntries(file, lines, isText);
	data.namedDate = named.anchor;
	data.recur = parseRecurrenceFrontmatter({ rawValue: recurValue, line: recurLine, fallbackStartDateKey: data.namedDate?.date ?? data.dateProp?.date ?? data.cdate?.date ?? null });
	data.contentDates = [...named.rangeEntries, ...(isText && !suppression.noparsed ? s.buildContentDates(file, lines) : [])];
	applyEntryState(previous, data);
	const edit = options.reason === "modify" || options.reason === "create";
	const bodyChanged = isText && previous.bodyHash != null && previous.bodyHash !== bodyHash;
	const binaryChanged = !isText && previous.indexedSize != null && previous.indexedSize !== data.indexedSize;
	if (edit && (bodyChanged || binaryChanged)) resetReviewedAnchors(data);
	if (previous.cdate && !useMdate && previous.anchorUsesMdate !== true) data.cdate.date = previous.cdate.date;
	s.files[file.path] = data;
	const search = s.plugin.timelineSearchIndex;
	if (search?.upsert) {
		const meta = [`ext:${file.extension}`];
		if (data.markColor != null) meta.push(`mark:${data.markColor}`);
		if (data.pinnedFile) meta.push("pinned");
		const cache = s.plugin.app?.metadataCache?.getFileCache?.(file);
		for (const tag of cache?.tags ?? []) if (tag.tag) meta.push(tag.tag);
		if (cache?.frontmatter) {
			meta.push(...frontmatterToIndexTokens(cache.frontmatter));
			for (const key of ["tags", "aliases"]) {
				const raw: unknown = cache.frontmatter[key];
				const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n]/g) : [];
				for (const value of values) if (typeof value === "string" && value.trim()) meta.push(value.trim());
			}
		}
		if (search.upsert({ id: file.path, kind: "file", path: file.path, basename: file.basename, directory: file.parent?.path ?? "", content: stripYamlFrontmatterBlock(normalized), meta: meta.join("\n") })) {
			markTimelineSearchIndexDirty(s.plugin); scheduleTimelineSearchCacheSave(s.plugin);
		}
	}
	s.updateAggregatedEntries(file.path, { skipSort: options.skipSort });
	if (isText && options.reason === "open") s.latestLines[file.path] = lines.slice(0, 2000);
	else delete s.latestLines[file.path];
}
