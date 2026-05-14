import type { EpochPlugin } from "../../../main";
import { normalizeIsoDatePrefix } from "../../../utils";

import { hasEpochInputAiSummaryError } from "../epoch-input-ai-fallback";
import { getYamlDescriptionPropertyKey, readFrontmatterProperty } from "../../frontmatter-keys";

const isDateKey = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

const toUtcDateKey = (ms: number): string => {
	const d = new Date(ms);
	if (!Number.isFinite(d.getTime())) return "";
	const yyyy = String(d.getUTCFullYear());
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
};

const tryParseSingleDateKey = (raw: string): string => {
	const s = normalizeIsoDatePrefix(String(raw ?? "").trim());
	if (!s) return "";
	if (s.includes("\n") || s.includes("\r")) return "";
	if (s.length > 48) return "";
	{
		const m = s.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\(\d+\))?$/);
		if (m && isDateKey(String(m[1] ?? ""))) return String(m[1]);
	}
	if (isDateKey(s)) return s;
	if (!/[0-9]/.test(s)) return "";
	if (!/^[A-Za-z0-9\s,./-]+$/.test(s)) return "";
	const parsed = Date.parse(s);
	if (!Number.isFinite(parsed)) return "";
	return toUtcDateKey(parsed);
};

const tryParseDateKeyFromDailyNotePath = (rawPath: string): string => {
	const p = String(rawPath ?? "").trim();
	if (!p || p.startsWith("epoch://")) return "";
	const normalized = p.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dot = fileName.lastIndexOf(".");
	const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
	const m = base.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\(\d+\))?$/);
	if (!m) return "";
	const d = String(m[1] ?? "");
	return isDateKey(d) ? d : "";
};

const isDateOnlyAnchorSummary = (summaryText: string, entryDate: string): boolean => {
	const s = String(summaryText ?? "").trim();
	const d = String(entryDate ?? "").trim();
	if (!s || !d) return false;
	if (!isDateKey(d)) return false;
	const parsed = tryParseSingleDateKey(s);
	return !!parsed && parsed === d;
};

const isDateOnlyDailyNoteStub = (summaryText: string, filePath: string): boolean => {
	const s = String(summaryText ?? "").trim();
	if (!s) return false;
	const fileDate = tryParseDateKeyFromDailyNotePath(filePath);
	if (!fileDate) return false;
	const parsed = tryParseSingleDateKey(s);
	return !!parsed && parsed === fileDate;
};

const isEmptyDailyNoteStub = (summaryText: string, filePath: string): boolean => {
	const s = String(summaryText ?? "").trim();
	if (s) return false;
	return !!tryParseDateKeyFromDailyNotePath(filePath);
};

export function getPreferredEpochFileLabel(plugin: EpochPlugin, filePath: string): string {
	const path = String(filePath || "").trim();
	if (!path) return "";
	// Epoch AI inputs should always include the full file path (path + note name)
	// to make each record traceable, and should not append extracted titles.
	return path;
}

export function formatEpochItemText(plugin: EpochPlugin, e: any): string {
	const hasAiError = hasEpochInputAiSummaryError(plugin as any, e);
	const ai = !hasAiError && typeof e?.aiSummary === "string" ? String(e.aiSummary).trim() : "";
	const base = typeof e?.summary === "string" ? String(e.summary).trim() : "";
	const filePath = typeof e?.file === "string" ? String(e.file) : "";
	const yamlDescription = (() => {
		try {
			if (!filePath) return "";
			const descriptionKey = getYamlDescriptionPropertyKey(plugin);
			const appAny: any = (plugin as any)?.app;
			const file = appAny?.vault?.getAbstractFileByPath?.(filePath);
			if (!file) return "";
			const cache = appAny?.metadataCache?.getFileCache?.(file);
			const raw = readFrontmatterProperty(cache?.frontmatter, descriptionKey);
			if (typeof raw === "string") return raw.trim();
			if (typeof raw === "number") return String(raw);
			return "";
		} catch {
			return "";
		}
	})();
	const summaryText = yamlDescription || ai || base;
	const fileLabel = filePath ? getPreferredEpochFileLabel(plugin, filePath) : "";
	const src = typeof e?.source === "string" ? String(e.source) : "";
	const entryDate = typeof e?.date === "string" ? String(e.date).trim() : "";

	// Suppress empty “daily note” stubs.
	// Key off the date-named filename so this also suppresses cdate-on-creation-day
	// rows that would otherwise pollute higher-bucket epochs (2days/week/month).
	if (isEmptyDailyNoteStub(summaryText, filePath)) return "";
	if (summaryText && isDateOnlyDailyNoteStub(summaryText, filePath)) return "";

	// Tracked change entries should read like actions.
	if (src === "tracked") {
		const change = typeof e?.trackedChange === "string" ? String(e.trackedChange) : "";
		// When summary comes from YAML description, normalize to "Edited" regardless of tracked change type
		// to avoid showing redundant prefixes (Added TODO, Edited TODO, Removed TODO) for the same item
		const usesYamlDescription = yamlDescription && summaryText === yamlDescription;
		const action = usesYamlDescription
			? "Edited"
			: (change === "removed" ? "Removed" :
			  change === "added" ? "Added" :
			  "Edited");
		if (summaryText) return `${action} ${summaryText}`;
		if (fileLabel) return `${action} "${fileLabel}"`;
		return action;
	}

	// Anchor-type entries (created date / filename date / dateprop) should remain readable.
	if (src === "cdate" || src === "namedate" || src === "dateprop") {
		if (isDateOnlyAnchorSummary(summaryText, entryDate)) return "";
		if (summaryText) return summaryText;
		if (fileLabel) return `"${fileLabel}"`;
		return "";
	}

	// Content entries are already summaries; fall back to file label when empty.
	if (summaryText) return summaryText;
	try {
		const lower = String(filePath || "").trim().toLowerCase();
		const isMarkdown = lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdown") || lower.endsWith(".mkd") || lower.endsWith(".mdx");
		if (isMarkdown) return "";
	} catch {
		// ignore
	}
	if (fileLabel) return `Updated "${fileLabel}"`;
	return "";
}
