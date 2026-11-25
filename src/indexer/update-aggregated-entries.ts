import { addEntries, removeEntriesForFile, sortIndex } from "./indexer-utils";
import { extractText, resolveSummaryForFile, stripDatesFromContentSummaryText } from "./summary-helpers";
import { formatDate } from "../utils";
import { expandRecurrenceToDateKeys } from "./recurrence";
import { extractFrontmatterDescription } from "./summarizer";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { getYamlDescriptionPropertyKey, readFrontmatterProperty } from "../plugin/frontmatter-keys";
import { isTodayPinMode, type DateEntry, type FileDateEntry } from "./types";
import type { IndexerPipeline } from "./pipeline";
import { TFile } from "obsidian";
import { applyReviewMutation } from "./review-state";

export function updateAggregatedEntriesInternal(s: IndexerPipeline, filePath: string, options: { skipSort?: boolean } = {}): void {
	removeEntriesForFile(s.index, filePath);
	const data = s.files[filePath];
	if (!data) { if (!options.skipSort) s.index = sortIndex(s.index); return; }
	const lines = s.latestLines[filePath] ?? [];
	const fullText = lines.join("\n");
	const todayKey = formatDate(s.today());
	const pinned = isTodayPinMode(data.pinnedFile);
	const descriptionKey = getYamlDescriptionPropertyKey(s.plugin);
	let described = extractFrontmatterDescription(fullText, descriptionKey).trim();
	if (!fullText) {
		const file = s.plugin.app?.vault?.getAbstractFileByPath?.(filePath);
		const fm = file instanceof TFile ? s.plugin.app.metadataCache?.getFileCache?.(file)?.frontmatter : null;
		const raw = readFrontmatterProperty(fm, descriptionKey);
		described = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw).trim() : "";
	}
	const summarize = (entry: FileDateEntry): FileDateEntry => {
		const result = { ...entry, markColor: data.markColor, markColorHex: data.markColorHex, pinned: entry.pinned === true || (pinned && entry.date === todayKey) };
		if (described) result.summary = resolveSummaryForFile(s.plugin, filePath, described, { includeFileName: false, skipFlatten: true });
		else if (lines.length) {
			const raw = entry.source === "content" && !entry.fromFrontmatter ? extractText(lines, entry.blockStart, entry.blockEnd) : fullText;
			const text = entry.source === "content" ? stripDatesFromContentSummaryText(raw) || raw.trim() : raw;
			result.summary = resolveSummaryForFile(s.plugin, filePath, text, { includeFileName: false });
		}
		return result;
	};
	const suppressed = data.noparsed || resolveFrontmatterSuppressionFlags(s.plugin, filePath).noparsed;
	const content = data.contentDates.filter(e => !(suppressed && e.source === "content")).map(summarize);
	const entries: DateEntry[] = s.buildMergedDates({ ...data, contentDates: content });
	const source = data.namedDate ?? data.dateProp ?? data.cdate;
	const anchor = source ? summarize(source) : null;
	if (anchor) {
		if (lines.length) source!.summary = anchor.summary;
		entries.push(anchor);
	}
	if (data.recur) {
		const rec = data.recur;
		const keys = expandRecurrenceToDateKeys({ recur: rec, fallbackFromKey: anchor?.date ?? null, todayKey });
		const summary = resolveSummaryForFile(s.plugin, filePath, described || fullText || anchor?.summary || `repeat: ${rec.raw}`, { includeFileName: false });
		for (const date of new Set(keys)) {
			const entry: DateEntry = { date, file: filePath, blockStart: rec.line, blockEnd: rec.line, summary, source: "content", fromFrontmatter: true, recurring: true, markColor: data.markColor, markColorHex: data.markColorHex, pinned: pinned && date === todayKey };
			const mutation = data.recurringReviewStates?.[date];
			if (mutation) applyReviewMutation(entry, mutation);
			entries.push(entry);
		}
	}
	if (anchor && pinned && anchor.date !== todayKey) entries.push({ ...anchor, date: todayKey, originalDate: anchor.date, pinned: true });
	const mtime = Number(data.indexedMtimeMs);
	if (Number.isFinite(mtime) && mtime > 0) for (const entry of entries) entry.fileMtimeMs = mtime;
	addEntries(s.index, entries);
	if (!options.skipSort) s.index = sortIndex(s.index);
	s.plugin.scheduleInheritedMarkRecompute?.("index");
}
