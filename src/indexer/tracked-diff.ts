import { diffLines } from "diff";
import type { FileDateEntry, TrackedChangeType } from "./types";

interface BuildTrackedEntriesParams {
	filePath: string;
	today: string;
	baseline: string;
	current: string;
	currentLines: string[];
	summarize: (change: TrackedChangeType, filePath: string, text: string) => string;
	hashText: (text: string) => string;
}

type TrackedFragment = {
	blockStart: number;
	blockEnd: number;
	trackedChange: TrackedChangeType;
	lines: string[];
};

export function buildTrackedEntriesFromDiff(params: BuildTrackedEntriesParams): FileDateEntry[] {
	const { filePath, today, baseline, current, currentLines, summarize, hashText } = params;
	const chunks = diffLines(baseline ?? "", current ?? "");
	const fragments: TrackedFragment[] = [];
	// let baselineLine = 0; // Removed unused baselineLine accumulator
	const pushFragment = (fragment: TrackedFragment) => {
		if (fragment.lines.length === 0) {
			return;
		}
		const previous = fragments[fragments.length - 1];
		if (
			previous &&
			previous.trackedChange === fragment.trackedChange &&
			previous.blockEnd + 1 >= fragment.blockStart
		) {
			previous.blockStart = Math.min(previous.blockStart, fragment.blockStart);
			previous.blockEnd = Math.max(previous.blockEnd, fragment.blockEnd);
			previous.lines.push(...fragment.lines);
			return;
		}
		fragments.push({
			blockStart: fragment.blockStart,
			blockEnd: fragment.blockEnd,
			trackedChange: fragment.trackedChange,
			lines: fragment.lines.slice()
		});
	};

	let currentLine = 0;

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const lineCount = countDiffLines(chunk.value);
		if (chunk.added) {
			const range = computeAdditionRange(currentLine, lineCount);
			const additionLines = splitDiffText(chunk.value).filter(line => line.trim().length > 0);
			if (range && additionLines.length > 0) {
				pushFragment({
					blockStart: range.start,
					blockEnd: range.end,
					trackedChange: "added",
					lines: additionLines
				});
			}
			currentLine += lineCount;
			continue;
		}

		if (chunk.removed) {
			const next = chunks[i + 1];
			if (next?.added) {
				const addedLineCount = countDiffLines(next.value);
				const removedLines = splitDiffText(chunk.value);
				const addedLines = splitDiffText(next.value);
				const { prefix, trimmedRemoved, trimmedAdded } = trimDiffContext(removedLines, addedLines);
				const changeStart = currentLine + prefix;
				if (trimmedRemoved.length === 0 && trimmedAdded.length === 0) {
					currentLine += addedLineCount;
					i++;
					continue;
				}

				const sharedLength = Math.min(trimmedRemoved.length, trimmedAdded.length);
				const modificationLines: string[] = [];
				const removalLines: string[] = [];
				const additionLines: string[] = [];

				for (let pairIndex = 0; pairIndex < sharedLength; pairIndex++) {
					const removedLine = trimmedRemoved[pairIndex] ?? "";
					const addedLine = trimmedAdded[pairIndex] ?? "";
					const removedTrim = removedLine.trim();
					const addedTrim = addedLine.trim();
					if (removedTrim && addedTrim) {
						modificationLines.push(addedLine);
						continue;
					}
					if (removedTrim && !addedTrim) {
						removalLines.push(removedLine);
						continue;
					}
					if (!removedTrim && addedTrim) {
						additionLines.push(addedLine);
					}
				}

				const remainingRemoved = removalLines
					.concat(trimmedRemoved.slice(sharedLength))
					.filter(line => line.trim().length > 0);
				const remainingAdded = additionLines
					.concat(trimmedAdded.slice(sharedLength))
					.filter(line => line.trim().length > 0);
				const meaningfulModificationLines = modificationLines.filter(line => line.trim().length > 0);

				if (meaningfulModificationLines.length > 0) {
					const modRange = computeAdditionRange(
						changeStart,
						Math.max(1, meaningfulModificationLines.length)
					);
					if (modRange) {
						pushFragment({
							blockStart: modRange.start,
							blockEnd: modRange.end,
							trackedChange: "modified",
							lines: meaningfulModificationLines.slice()
						});
					}
				}

				if (remainingRemoved.length > 0) {
					const removeRange = computeRemovalRange(changeStart, currentLines.length);
					if (removeRange) {
						pushFragment({
							blockStart: removeRange.start,
							blockEnd: removeRange.end,
							trackedChange: "removed",
							lines: remainingRemoved.slice()
						});
					}
				}

				if (remainingAdded.length > 0) {
					const addRange = computeAdditionRange(
						changeStart + meaningfulModificationLines.length,
						Math.max(1, remainingAdded.length)
					);
					if (addRange) {
						pushFragment({
							blockStart: addRange.start,
							blockEnd: addRange.end,
							trackedChange: "added",
							lines: remainingAdded.slice()
						});
					}
				}

				currentLine += addedLineCount;
				i++;
				continue;
			}

			const range = computeRemovalRange(currentLine, currentLines.length);
			const removalLines = splitDiffText(chunk.value).filter(line => line.trim().length > 0);
			if (range && removalLines.length > 0) {
				pushFragment({
					blockStart: range.start,
					blockEnd: range.end,
					trackedChange: "removed",
					lines: removalLines
				});
			}
			continue;
		}

		currentLine += lineCount;
	}

	const entries: FileDateEntry[] = [];
	for (const fragment of fragments) {
		const text = fragment.lines.join("\n");
		if (!text.trim()) continue;
		const summary = summarize(fragment.trackedChange, filePath, text);
		if (!summary) continue;
		entries.push({
			date: today,
			file: filePath,
			blockStart: fragment.blockStart,
			blockEnd: fragment.blockEnd,
			summary,
			source: "tracked",
			trackedChange: fragment.trackedChange,
			trackedHash: hashText(text)
		});
	}

	return entries;
}

function countDiffLines(value: string): number {
	if (!value) return 0;
	const normalized = value
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u2028|\u2029/g, "\n");
	const segments = normalized.split("\n");
	if (segments.length === 0) return 0;
	return normalized.endsWith("\n") ? segments.length - 1 : segments.length;
}

function splitDiffText(value: string): string[] {
	if (!value) return [];
	const normalized = value
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u2028|\u2029/g, "\n");
	if (!normalized) return [];
	const segments = normalized.split("\n");
	if (segments.length > 0 && segments[segments.length - 1] === "") {
		segments.pop();
	}
	return segments;
}

function trimDiffContext(removed: string[], added: string[]): {
	prefix: number;
	trimmedRemoved: string[];
	trimmedAdded: string[];
} {
	let prefix = 0;
	const maxPrefix = Math.min(removed.length, added.length);
	while (prefix < maxPrefix && removed[prefix] === added[prefix]) {
		prefix++;
	}
	let suffix = 0;
	const remainingRemoved = removed.length - prefix;
	const remainingAdded = added.length - prefix;
	const maxSuffix = Math.min(remainingRemoved, remainingAdded);
	while (
		suffix < maxSuffix &&
		removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]
	) {
		suffix++;
	}
	const trimmedRemoved =
		suffix > 0 ? removed.slice(prefix, removed.length - suffix) : removed.slice(prefix);
	const trimmedAdded =
		suffix > 0 ? added.slice(prefix, added.length - suffix) : added.slice(prefix);
	return { prefix, trimmedRemoved, trimmedAdded };
}

function computeAdditionRange(startLine: number, lineCount: number): { start: number; end: number } | null {
	if (lineCount === 0) return null;
	const start = Math.max(0, startLine);
	const end = Math.max(start, start + lineCount - 1);
	return { start, end };
}

function computeRemovalRange(cursor: number, totalLines: number): { start: number; end: number } | null {
	if (totalLines <= 0) {
		return { start: 0, end: 0 };
	}
	const clamped = Math.max(0, Math.min(totalLines - 1, cursor));
	return { start: clamped, end: clamped };
}
