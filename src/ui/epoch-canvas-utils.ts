import type { DateEntry, TrackedChangeType } from "../indexer/types";
import { formatDate } from "../utils";
import {
	SUMMARY_ICON_ATTACHMENT,
	SUMMARY_ICON_NOTE,
	SUMMARY_ICON_PARSED,
	SUMMARY_ICON_RECURRING,
	SUMMARY_ICON_PIN,
	SUMMARY_ICON_TRACKED_ADDED,
	SUMMARY_ICON_TRACKED_MODIFIED,
	SUMMARY_ICON_TRACKED_REMOVED,
	SUMMARY_ENTRY_SEPARATOR,
	SUMMARY_PREFIX_SEPARATOR
} from "./epoch-canvas-constants";

export function truncateHard(
	text: string,
	maxWidth: number,
	ctx: CanvasRenderingContext2D
): string {
	if (!text) return "";
	if (!(maxWidth > 0)) return "";
	if (ctx.measureText(text).width <= maxWidth) return text;

	const ell = "...";
	if (ctx.measureText(ell).width > maxWidth) return "";

	let baseText = text.trimEnd();
	if (baseText.endsWith("...")) {
		baseText = baseText.slice(0, -3).trimEnd();
	} else if (baseText.endsWith("…")) {
		baseText = baseText.slice(0, -1).trimEnd();
	}

	let low = 0;
	let high = baseText.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		const candidate = baseText.slice(0, mid).trimEnd() + ell;
		if (ctx.measureText(candidate).width <= maxWidth) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	const len = Math.max(0, low - 1);
	return baseText.slice(0, len).trimEnd() + ell;
}

export function dist(a: Touch, b: Touch): number {
	const dx = a.clientX - b.clientX;
	const dy = a.clientY - b.clientY;
	return Math.hypot(dx, dy);
}

export function mid(a: Touch, b: Touch): { x: number; y: number } {
	return {
		x: (a.clientX + b.clientX) / 2,
		y: (a.clientY + b.clientY) / 2
	};
}

export function parseFontSize(font: string): { size: number; prefix: string; suffix: string } {
	const raw = String(font ?? "");
	const m = raw.match(/(\d+(?:\.\d+)?)px/);
	if (!m || m.index == null) {
		// Unknown font shorthand; preserve the raw string as suffix so callers can still
		// produce something reasonable like "12px<suffix>".
		return { size: 12, prefix: "", suffix: raw };
	}
	const size = parseFloat(m[1]);
	const idx = m.index;
	const prefix = raw.slice(0, idx);
	const suffix = raw.slice(idx + m[0].length);
	return { size: Number.isFinite(size) ? size : 12, prefix, suffix };
}

export function mixFont(base: string, hover: string, t: number): string {
	const b = parseFontSize(base);
	const h = parseFontSize(hover || base);
	const size = b.size + (h.size - b.size) * t;
	return `${b.prefix}${size.toFixed(2)}px${b.suffix}`;
}

export function withFontWeight(font: string, weight: string): string {
	const parsed = parseFontSize(font);
	const weightPattern = /^(thin|extra-light|ultra-light|light|normal|regular|medium|semi-bold|demi-bold|bold|extra-bold|ultra-bold|heavy|black|[1-9]00)$/i;
	const stylePattern = /^(italic|oblique|normal)$/i;
	const tokens = String(parsed.prefix || "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	let styleToken: string | undefined;
	let weightToken: string | undefined;
	const restTokens: string[] = [];
	for (const tok of tokens) {
		if (!styleToken && stylePattern.test(tok)) {
			styleToken = tok;
			continue;
		}
		if (!weightToken && weightPattern.test(tok)) {
			weightToken = tok;
			continue;
		}
		restTokens.push(tok);
	}

	weightToken = weight ? String(weight) : weightToken;
	const outTokens: string[] = [];
	if (styleToken) outTokens.push(styleToken);
	if (weightToken) outTokens.push(weightToken);
	if (restTokens.length) outTokens.push(...restTokens);
	const prefixOut = outTokens.length ? outTokens.join(" ") + " " : "";
	return `${prefixOut}${parsed.size}px${parsed.suffix || ""}`.trimEnd();
}

export function withFontStyle(font: string, style: "italic" | "normal" | "oblique"): string {
	const parsed = parseFontSize(font);
	const weightPattern = /^(thin|extra-light|ultra-light|light|normal|regular|medium|semi-bold|demi-bold|bold|extra-bold|ultra-bold|heavy|black|[1-9]00)$/i;
	const stylePattern = /^(italic|oblique|normal)$/i;
	const tokens = String(parsed.prefix || "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	let styleToken: string | undefined;
	let weightToken: string | undefined;
	const restTokens: string[] = [];
	for (const tok of tokens) {
		if (!styleToken && stylePattern.test(tok)) {
			styleToken = tok;
			continue;
		}
		if (!weightToken && weightPattern.test(tok)) {
			weightToken = tok;
			continue;
		}
		restTokens.push(tok);
	}

	styleToken = style ? String(style) : styleToken;
	const outTokens: string[] = [];
	if (styleToken) outTokens.push(styleToken);
	if (weightToken) outTokens.push(weightToken);
	if (restTokens.length) outTokens.push(...restTokens);
	const prefixOut = outTokens.length ? outTokens.join(" ") + " " : "";
	return `${prefixOut}${parsed.size}px${parsed.suffix || ""}`.trimEnd();
}

export function shouldRenderEntry(entry: DateEntry): boolean {
	if (!entry) return false;
	return entry.reviewState !== "hidden";
}

type TimelineCandidate = {
	entry: DateEntry;
	order: number;
};

function blockPosition(entry: DateEntry): number {
	const { blockEnd, blockStart } = entry;
	if (Number.isFinite(blockEnd)) return blockEnd;
	return Number.isFinite(blockStart) ? blockStart : 0;
}

function trackedTimestamp(entry: DateEntry): number {
	if (!entry || entry.source !== "tracked") return Number.NEGATIVE_INFINITY;
	const raw = entry.trackedTime;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string") {
		const parsed = Date.parse(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Number.NEGATIVE_INFINITY;
}

function timelineSourcePriority(entry: DateEntry): number {
	if (entry?.pinned === true) return 0;
	switch (entry?.source) {
		case "tracked":
			return 1;
		case "content":
			return 2;
		case "namedate":
		case "dateprop":
		case "cdate":
			return 3;
		default:
			return 9;
	}
}

function pickTimelineCandidate(candidates: TimelineCandidate[]): TimelineCandidate | null {
	if (candidates.length === 0) return null;
	const tracked = candidates.filter(candidate => candidate.entry.source === "tracked");
	if (tracked.length > 0) {
		tracked.sort((a, b) => {
			const timeA = trackedTimestamp(a.entry);
			const timeB = trackedTimestamp(b.entry);
			if (timeA !== timeB) return timeB - timeA;
			if (a.order !== b.order) return b.order - a.order;
			return blockPosition(b.entry) - blockPosition(a.entry);
		});
		return tracked[0];
	}
	const content = candidates.filter(candidate => candidate.entry.source === "content");
	if (content.length > 0) {
		const nonRecurring = content.filter(c => c.entry.recurring !== true);
		const pool = nonRecurring.length > 0 ? nonRecurring : content;
		pool.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return blockPosition(a.entry) - blockPosition(b.entry);
		});
		return pool[0];
	}
	const named = candidates.find(candidate => candidate.entry.source === "namedate");
	if (named) return named;
	const dateprop = candidates.find(candidate => candidate.entry.source === "dateprop");
	if (dateprop) return dateprop;
	const cdate = candidates.find(candidate => candidate.entry.source === "cdate");
	if (cdate) return cdate;
	const pinned = candidates.filter(candidate => candidate.entry.pinned === true);
	if (pinned.length > 0) {
		pinned.sort((a, b) => a.order - b.order);
		return pinned[0];
	}
	const ordered = candidates.slice().sort((a, b) => a.order - b.order);
	return ordered[0];
}

export function selectTimelineEntries(entries: DateEntry[]): DateEntry[] {
	if (!Array.isArray(entries) || entries.length <= 1) {
		return entries.slice();
	}
	const mtimeByFile = new Map<string, number>();
	const readFileMtimeMs = (entry: DateEntry): number => {
		const direct = Number(entry.fileMtimeMs ?? Number.NaN);
		if (Number.isFinite(direct) && direct > 0) return direct;
		const fp = String(entry.file ?? "");
		if (!fp) return Number.NaN;
		const cached = mtimeByFile.get(fp);
		if (cached !== undefined) return cached;
		let resolved = Number.NaN;
		try {
			const app = (window as unknown as { app?: { vault?: { getAbstractFileByPath?: (path: string) => unknown } } }).app;
			const af = app?.vault?.getAbstractFileByPath?.(fp) as { stat?: { mtime?: unknown } } | undefined;
			const m = Number(af?.stat?.mtime ?? Number.NaN);
			if (Number.isFinite(m) && m > 0) resolved = m;
		} catch {
			resolved = Number.NaN;
		}
		mtimeByFile.set(fp, resolved);
		return resolved;
	};
	const grouped = new Map<string, TimelineCandidate[]>();
	entries.forEach((entry, index) => {
		const bucket = grouped.get(entry.file);
		const candidate: TimelineCandidate = { entry, order: index };
		if (bucket) {
			bucket.push(candidate);
		} else {
			grouped.set(entry.file, [candidate]);
		}
	});
	const selected: TimelineCandidate[] = [];
	for (const bucket of grouped.values()) {
		const chosen = pickTimelineCandidate(bucket);
		if (chosen) {
			selected.push(chosen);
		}
	}
	selected.sort((a, b) => {
		const sourceA = timelineSourcePriority(a.entry);
		const sourceB = timelineSourcePriority(b.entry);
		if (sourceA !== sourceB) return sourceA - sourceB;

		const mA = readFileMtimeMs(a.entry);
		const mB = readFileMtimeMs(b.entry);
		const hasA = Number.isFinite(mA);
		const hasB = Number.isFinite(mB);
		if (hasA && hasB && mA !== mB) return mB - mA;
		if (hasA && !hasB) return -1;
		if (!hasA && hasB) return 1;
		return a.order - b.order;
	});
	return selected.map(candidate => candidate.entry);
}

export function pickTimelineEntryForFile(entries: DateEntry[]): DateEntry | null {
	const selected = selectTimelineEntries(entries);
	return selected[0] ?? null;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getEpochRangeFromEntry(entry: DateEntry | null | undefined): { start: string; end: string } | null {
	if (!entry) return null;
	const start = String(entry.epochStart || "");
	const end = String(entry.epochEnd || "");
	if (DATE_KEY_RE.test(start) && DATE_KEY_RE.test(end)) {
		return { start, end };
	}
	const file = String(entry.file || "");
	if (file.startsWith("epoch://")) {
		// Format: epoch://<bucket>/<start>-<end>
		const rest = file.slice("epoch://".length);
		const slash = rest.indexOf("/");
		if (slash >= 0) {
			const tail = rest.slice(slash + 1);
			const m = tail.match(/^(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/);
			if (m) {
				const startKey = m[1];
				const endKey = m[2];
				if (DATE_KEY_RE.test(startKey) && DATE_KEY_RE.test(endKey)) {
					return { start: startKey, end: endKey };
				}
			}
		}
	}
	return null;
}

export function entryFileName(entry: DateEntry): string {
	if (!entry) return "";
	const parts = entry.file?.split?.("/") ?? [];
	if (parts.length === 0) return entry.file || "";
	return parts[parts.length - 1] || entry.file;
}

function entryDisplayName(entry: DateEntry): string {
	const name = entryFileName(entry);
	if (!name) return "";
	return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

const TRACKED_ICON_BY_CHANGE: Record<TrackedChangeType, string> = {
	added: SUMMARY_ICON_TRACKED_ADDED,
	removed: SUMMARY_ICON_TRACKED_REMOVED,
	modified: SUMMARY_ICON_TRACKED_MODIFIED
};

const SUMMARY_ICON_LABELS: Record<string, string> = {};
if (SUMMARY_ICON_PIN) SUMMARY_ICON_LABELS[SUMMARY_ICON_PIN] = "PIN";
if (SUMMARY_ICON_NOTE) SUMMARY_ICON_LABELS[SUMMARY_ICON_NOTE] = "NOTE";
if (SUMMARY_ICON_PARSED) SUMMARY_ICON_LABELS[SUMMARY_ICON_PARSED] = "DATE";
if (SUMMARY_ICON_RECURRING) SUMMARY_ICON_LABELS[SUMMARY_ICON_RECURRING] = "RECUR";
if (SUMMARY_ICON_ATTACHMENT) SUMMARY_ICON_LABELS[SUMMARY_ICON_ATTACHMENT] = "FILE";
SUMMARY_ICON_LABELS["epochgram-logo"] = "EPOCH";
SUMMARY_ICON_LABELS[SUMMARY_ICON_TRACKED_ADDED] = "+";
SUMMARY_ICON_LABELS[SUMMARY_ICON_TRACKED_REMOVED] = "-";
SUMMARY_ICON_LABELS[SUMMARY_ICON_TRACKED_MODIFIED] = "EDIT";

export function summaryIconLabel(iconId: string): string {
	return SUMMARY_ICON_LABELS[iconId] ?? iconId.toUpperCase();
}

function isMarkdownEntry(entry: DateEntry): boolean {
	const file = entry.file ?? "";
	return file.toLowerCase().endsWith(".md");
}

export function entrySummaryComponents(entry: DateEntry): { base: string; iconIds: string[] } {
	const base = (entry.summary || "").trim();
	const iconIds: string[] = [];
	const addIcon = (value: string | undefined) => {
		if (!value) return;
		if (iconIds.includes(value)) return;
		iconIds.push(value);
	};

	const todayKey = formatDate(new Date());
	const shouldShowPin = entry.pinned === true && entry.date === todayKey;

	if (shouldShowPin) {
		addIcon(SUMMARY_ICON_PIN);
		return { base, iconIds };
	}

	switch (entry.source) {
		case "epoch":
			addIcon("epochgram-logo");
			break;
		case "tracked": {
			const tracked = entry.trackedChange ?? "modified";
			addIcon(TRACKED_ICON_BY_CHANGE[tracked]);
			break;
		}
		case "content":
			addIcon(entry.recurring ? SUMMARY_ICON_RECURRING : SUMMARY_ICON_PARSED);
			break;
		case "cdate":
		case "namedate":
			if ((entry as DateEntry & { namedDateRange?: boolean }).namedDateRange === true) {
				addIcon(SUMMARY_ICON_PARSED);
				if (!isMarkdownEntry(entry)) addIcon(SUMMARY_ICON_ATTACHMENT);
				break;
			}
			addIcon(isMarkdownEntry(entry) ? SUMMARY_ICON_NOTE : SUMMARY_ICON_ATTACHMENT);
			break;
		case "dateprop":
			addIcon(isMarkdownEntry(entry) ? SUMMARY_ICON_NOTE : SUMMARY_ICON_ATTACHMENT);
			break;
		default:
			if (!isMarkdownEntry(entry)) {
				addIcon(SUMMARY_ICON_ATTACHMENT);
			}
	}

	return { base, iconIds };
}

export function formatEntrySummary(
	entry: DateEntry,
	options: { fallbackToFileName?: boolean; includeIcons?: boolean; filenameWordsCount?: number; summaryWordsCount?: number } = {}
): string {
	const tokenizeSummary = (value: string): string[] => value.match(/\[[xX ]\]|\S+/g) ?? [];
	const isIgnoredSummaryToken = (token: string): boolean => token === "↗︎" || token === "↗" || /^\[[xX ]\]$/.test(token);
	const truncateSummaryWords = (value: string): string => {
		const limit = Number(options.summaryWordsCount);
		if (!Number.isFinite(limit) || limit <= 0) return String(value ?? "").trim();
		const tokens = tokenizeSummary(String(value ?? "").trim());
		if (tokens.length === 0) return "";
		let totalWords = 0;
		for (const token of tokens) {
			if (!isIgnoredSummaryToken(token)) totalWords++;
		}
		if (totalWords <= limit) return tokens.join(" ").trim();
		const out: string[] = [];
		let usedWords = 0;
		for (const token of tokens) {
			if (isIgnoredSummaryToken(token)) {
				out.push(token);
				continue;
			}
			if (usedWords >= limit) break;
			out.push(token);
			usedWords++;
			if (usedWords >= limit) break;
		}
		let summary = out.join(" ").trim();
		if (summary && !summary.endsWith("...")) summary += "...";
		return summary;
	};

	const { base, iconIds } = entrySummaryComponents(entry);
	let text = base;
	const filePrefix = entryDisplayName(entry);
	const filenameWords = options.filenameWordsCount;
	const summaryWords = options.summaryWordsCount;
	// When summary is disabled (summaryWordsCount === 0), don't show summary text
	const showSummary = summaryWords !== 0;
	const showNoteName = filenameWords === undefined || filenameWords > 0;
	let displayPrefix = filePrefix;
	if (showNoteName && filenameWords !== undefined && filenameWords > 0 && filePrefix) {
		const words = filePrefix
			.split(/\s+/)
			.filter(Boolean)
			.filter((w) => /[\p{L}\p{N}]/u.test(w));
		if (words.length > filenameWords) {
			// Remove trailing punctuation from the last word
			const truncated = words.slice(0, filenameWords).map((w, i, arr) => {
				if (i === arr.length - 1) {
					return w.replace(/[\p{P}\p{S}]+$/gu, "");
				}
				return w;
			});
			displayPrefix = truncated.join(" ") + "...";
		} else {
			displayPrefix = filePrefix;
		}
	}
	if (filePrefix) {
		if (text && showSummary) {
			if (showNoteName) {
				const sameAsPrefix = text.trim().toLowerCase() === filePrefix.trim().toLowerCase();
				if (sameAsPrefix) {
					text = displayPrefix;
				} else if (text.startsWith(filePrefix + SUMMARY_ENTRY_SEPARATOR)) {
					const afterSep = text.slice((filePrefix + SUMMARY_ENTRY_SEPARATOR).length);
					text = `${displayPrefix}${SUMMARY_ENTRY_SEPARATOR}${truncateSummaryWords(afterSep)}`;
				} else {
					text = `${displayPrefix}${SUMMARY_ENTRY_SEPARATOR}${truncateSummaryWords(text)}`;
				}
			} else {
				if (text.startsWith(filePrefix + SUMMARY_ENTRY_SEPARATOR)) {
					text = text.slice((filePrefix + SUMMARY_ENTRY_SEPARATOR).length);
				} else if (text.trim().toLowerCase() === filePrefix.trim().toLowerCase()) {
					text = "";
				}
				text = truncateSummaryWords(text);
			}
		} else if (options.fallbackToFileName || !showSummary) {
			text = displayPrefix;
		}
	} else if (!text && options.fallbackToFileName) {
		text = entryFileName(entry);
	} else if (text && showSummary) {
		text = truncateSummaryWords(text);
	}
	const includeIcons = options.includeIcons !== false;
	if (!includeIcons || iconIds.length === 0) {
		return text;
	}
	const iconLabels = iconIds
		.map(summaryIconLabel)
		.filter(label => label && label.length > 0);
	if (iconLabels.length === 0) {
		return text;
	}
	const prefix = iconLabels.join(SUMMARY_PREFIX_SEPARATOR);
	if (!text) {
		return prefix;
	}
	return `${prefix}${SUMMARY_PREFIX_SEPARATOR}${text}`;
}
