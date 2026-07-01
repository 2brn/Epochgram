import { extractFrontmatterDescription, makeSummary } from "./summarizer";
import { SUMMARY_ENTRY_SEPARATOR } from "../ui/epoch-canvas-constants";
import type { FileDateEntry } from "./types";
import { stripYamlFrontmatterBlock } from "../utils";
import { getYamlDescriptionPropertyKey } from "../plugin/frontmatter-keys";

interface SummaryOptions {
	includeFileName?: boolean;
	ignoreFrontmatterDescription?: boolean;
	skipFlatten?: boolean;
}

type SummaryPluginLike = {
	settings?: {
		summaryWordsCount?: number;
	};
};

const ORD_SUFFIX = "(?:st|nd|rd|th)";
const MONTH_NAME = "(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";

export function stripDatesFromContentSummaryText(raw: string): string {
	let text = String(raw ?? "");
	if (!text.trim()) return "";

	// ISO-ish timestamps
	text = text.replace(
		/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
		" "
	);

	// Common numeric date formats
	text = text.replace(/\b\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g, " ");
	text = text.replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, " ");

	// Month name formats (with explicit year)
	text = text.replace(new RegExp(`\\b\\d{1,2}${ORD_SUFFIX}?\\s+${MONTH_NAME}\\s+\\d{4}\\b`, "gi"), " ");
	text = text.replace(new RegExp(`\\b${MONTH_NAME}\\s+\\d{1,2}${ORD_SUFFIX}?,?\\s+\\d{4}\\b`, "gi"), " ");
	text = text.replace(new RegExp(`\\b\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?\\s+${MONTH_NAME}\\s+\\d{4}\\b`, "gi"), " ");

	// Cleanup extra whitespace / punctuation artifacts left behind.
	text = text
		.replace(/[\u2013\u2014]/g, "-")
		.replace(/[ \t]+([,.;:])/g, "$1")
		.replace(/([,.;:])[ \t]+/g, "$1 ")
		.replace(/^[,.;:]+\s*/g, "")
		.replace(/\s*[,.;:]+$/g, "")
		.replace(/[ \t]{2,}/g, " ")
		.trim();

	return text;
}

export function extractText(lines: string[], start: number, end: number): string {
	if (lines.length === 0) return "";
	const slice = lines.slice(start, end + 1);
	return slice.join("\n").trim();
}

export function resolveSummaryForFile(
	plugin: SummaryPluginLike,
	path: string,
	text: string,
	options: SummaryOptions = {}
): string {
	const { includeFileName = false, ignoreFrontmatterDescription = false, skipFlatten = false } = options;
	const fileName = getFileNameFromPath(path);
	const displayName = getDisplayNameForSummary(path, includeFileName);
	const rawText = typeof text === "string" ? text : "";
	const descriptionKey = getYamlDescriptionPropertyKey(plugin);
	const described = ignoreFrontmatterDescription ? "" : extractFrontmatterDescription(rawText, descriptionKey).trim();
	const stripped = stripYamlFrontmatterBlock(rawText);
	const strippedText = typeof stripped === "string" ? stripped.trim() : "";
	const baseContent = described || strippedText;
	// If the note is effectively empty after stripping YAML frontmatter (common for
	// daily notes created with only a `date` property), treat it as empty and fall
	// back to the filename/title rather than summarizing YAML.
	const hadFrontmatter = /^[\uFEFF]?---\r?\n/.test(String(rawText || "").trim());
	if (hadFrontmatter && !baseContent) {
		return getDisplayNameForSummary(path, true) || fileName;
	}
	const segments: string[] = [];
	if (displayName) segments.push(displayName);
	if (baseContent) segments.push(baseContent);
	const combined = segments.join(SUMMARY_ENTRY_SEPARATOR).trim();
	const raw = maybeSummarize(plugin, combined, skipFlatten || !!described).trim();
	if (raw) return raw;
	if (isSummaryDisabled(plugin)) return getDisplayNameForSummary(path, true) || fileName;
	if (displayName) return displayName;
	if (includeFileName) return fileName;
	return "";
}

export function resolveSummaryForEntry(plugin: SummaryPluginLike, entry: FileDateEntry, text: string): string {
	return resolveSummaryForFile(plugin, entry.file, text, {
		includeFileName: false
	});
}

function getFileNameFromPath(path: string): string {
	if (!path) return "";
	const idx = path.lastIndexOf("/");
	return idx >= 0 ? path.slice(idx + 1) : path;
}

function maybeSummarize(plugin: SummaryPluginLike, text: string, skipFlatten = false): string {
	if (!text) return "";
	const words = Math.max(0, plugin?.settings?.summaryWordsCount ?? 0);
	if (words <= 0) return "";
	return makeSummary(text, words, { skipFlatten });
}

function isSummaryDisabled(plugin: SummaryPluginLike): boolean {
	const words = Math.max(0, plugin?.settings?.summaryWordsCount ?? 0);
	return words <= 0;
}

function getDisplayNameForSummary(path: string, includeFileName: boolean): string {
	if (!includeFileName) return "";
	const name = getFileNameFromPath(path);
	if (!name) return "";
	if (name.toLowerCase().endsWith(".md")) {
		const sliced = name.slice(0, -3);
		return sliced.length > 0 ? sliced : name;
	}
	return name;
}
