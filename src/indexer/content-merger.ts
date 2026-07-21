import type { FileDateEntry } from "./types";
import { extractText, resolveSummaryForEntry, resolveSummaryForFile, stripDatesFromContentSummaryText } from "./summary-helpers";

type SummaryPluginLike = {
	settings?: {
		summaryWordsCount?: number;
	};
};

type FileDateEntryWithExtras = FileDateEntry & {
	fromFrontmatter?: boolean;
	markColor?: number;
};

export function mergeConsecutiveEntries(
	plugin: SummaryPluginLike,
	entries: FileDateEntry[],
	lines: string[]
): FileDateEntry[] {
	if (entries.length === 0) return [];
	const sorted = entries
		.slice()
		.sort((a, b) => {
			if (a.blockStart !== b.blockStart) return a.blockStart - b.blockStart;
			return a.blockEnd - b.blockEnd;
		});

	const expanded = sorted.map((entry, idx) => {
		const next = sorted[idx + 1];
		const nextStart = next ? next.blockStart : lines.length;
		let end = entry.blockEnd;
		if (lines.length > 0) {
			const maxEnd = Math.min(lines.length - 1, Math.max(entry.blockStart, nextStart - 1));
			end = Math.max(entry.blockStart, Math.max(entry.blockEnd, maxEnd));
			while (end > entry.blockStart && !(lines[end]?.trim())) {
				end--;
			}
		}
		return { ...entry, blockEnd: end };
	});

	const merged: FileDateEntry[] = [];
	let current = { ...expanded[0] };

	const pushCurrent = () => {
		const text = extractText(lines, current.blockStart, current.blockEnd);
		if (current.source === "content") {
			if ((current as FileDateEntryWithExtras).fromFrontmatter === true) {
				const fullText = Array.isArray(lines) && lines.length > 0 ? lines.join("\n") : "";
				const cleaned = stripDatesFromContentSummaryText(fullText);
				const summary = resolveSummaryForFile(plugin, current.file, cleaned, { includeFileName: false });
				merged.push({ ...current, summary });
				return;
			}
			const cleaned = stripDatesFromContentSummaryText(text) || text.trim();
			const summary = resolveSummaryForEntry(plugin, current, cleaned);
			merged.push({ ...current, summary });
			return;
		}
		const summary = resolveSummaryForEntry(plugin, current, text);
		merged.push({ ...current, summary });
	};

	for (let i = 1; i < expanded.length; i++) {
		const next = expanded[i];
		const curFromFrontmatter = (current as FileDateEntryWithExtras).fromFrontmatter === true;
		const nextFromFrontmatter = (next as FileDateEntryWithExtras).fromFrontmatter === true;
		if (
			next.date === current.date &&
			next.file === current.file &&
			next.source === current.source &&
			curFromFrontmatter === nextFromFrontmatter
		) {
			current.blockStart = Math.min(current.blockStart, next.blockStart);
			current.blockEnd = Math.max(current.blockEnd, next.blockEnd);
			const nextMark = typeof (next as FileDateEntryWithExtras).markColor === "number" ? (next as FileDateEntryWithExtras).markColor : null;
			if (nextMark != null) {
				const curMark = typeof (current as FileDateEntryWithExtras).markColor === "number" ? (current as FileDateEntryWithExtras).markColor : null;
				if (curMark == null) (current as FileDateEntryWithExtras).markColor = nextMark;
			}
			const nextMarkHex = typeof (next as { markColorHex?: unknown }).markColorHex === "string"
				? String((next as { markColorHex?: string }).markColorHex || "").trim()
				: ""
			if (nextMarkHex) {
				const curMarkHex = typeof (current as { markColorHex?: unknown }).markColorHex === "string"
					? String((current as { markColorHex?: string }).markColorHex || "").trim()
					: "";
				if (!curMarkHex) (current as { markColorHex?: string }).markColorHex = nextMarkHex;
			}
		} else {
			pushCurrent();
			current = { ...next };
		}
	}

	pushCurrent();
	return merged;
}
