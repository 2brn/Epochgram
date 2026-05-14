import type { TFile } from "obsidian";
import type { FileDateEntry, FileIndexData } from "./types";
import { formatDate } from "utils";
import { normalizeSnapshotValue, snapshotsEqual } from "./snapshot-helpers";
import { buildTrackedEntriesFromDiff } from "./tracked-diff";
import { resolveSummaryForFile } from "./summary-helpers";
import { hashText } from "./tracked-blocks";
import { trackedEntryKey, trackedEntriesEquivalent } from "./entry-state";
import { extractFrontmatterDescription } from "./summarizer";
import type { IndexerPipeline } from "./pipeline";
import { resolveFrontmatterSuppressionFlags } from "./frontmatter-flags";
import { stripYamlFrontmatterBlock } from "../utils";
import { getYamlDescriptionPropertyKey } from "../plugin/frontmatter-keys";

export function updateTrackedDatesInternal(
	s: IndexerPipeline,
	file: TFile,
	data: FileIndexData,
	lines: string[]
): void {
	const stripForTracking = (value: string | null | undefined): string | null => {
		const normalized = normalizeSnapshotValue(value);
		if (normalized == null) return null;
		return normalizeSnapshotValue(stripYamlFrontmatterBlock(normalized)) ?? "";
	};

	try {
		const rawText = Array.isArray(lines) && lines.length > 0 ? lines.slice(0, 250).join("\n") : "";
		const suppression = data.notracked === true
			? { notracked: true, noparsed: false }
			: resolveFrontmatterSuppressionFlags(s.plugin, file, rawText);
		if (suppression.notracked) {
			data.trackedDates = {};
			return;
		}
	} catch {
		// ignore
	}
	const systemDay = formatDate(s.today());
	const clampedMtimeMs = (() => {
		const nowMs = s.today().getTime();
		const mtime = Number((file as any)?.stat?.mtime);
		if (!Number.isFinite(mtime) || mtime <= 0) return nowMs;
		return Math.min(mtime, nowMs);
	})();
	const fileDay = formatDate(new Date(clampedMtimeMs));

	// Default to bucketing tracked changes under the current day.
	// If the file was last seen on an earlier day (e.g. this device was offline) and the
	// file's mtime indicates it was modified on a prior day, bucket tracked changes under
	// that mtime day to avoid showing sync-delivered edits as "today".
	let dayKey = systemDay;
	const lastSnapshotDay = typeof data.trackedSnapshotDate === "string" ? data.trackedSnapshotDate : null;
	if (
		lastSnapshotDay &&
		s.isDateBefore(lastSnapshotDay, systemDay) &&
		s.isDateBefore(fileDay, systemDay) &&
		!s.isDateBefore(fileDay, lastSnapshotDay)
	) {
		dayKey = fileDay;
	}
	try {
		if ((data as any)?.__pendingTrackedReviewStateClear === true) {
			(data as any).__trackedReviewStateClearedDates = [dayKey];
			delete (data as any).__pendingTrackedReviewStateClear;
		}
	} catch {
		// ignore
	}
	const currentContent = stripForTracking(lines.join("\n")) ?? "";
	const describedSummary = (() => {
		try {
			const described = extractFrontmatterDescription(
				lines.join("\n"),
				getYamlDescriptionPropertyKey(s.plugin)
			).trim();
			if (!described) return "";
			return resolveSummaryForFile(s.plugin, file.path, described, {
				includeFileName: false,
				skipFlatten: true
			});
		} catch {
			return "";
		}
	})();
	const previousSnapshot = stripForTracking(data.trackedSnapshot);
	const previousBaseline = stripForTracking(data.trackedBaselineSnapshot);
	const previousEntries = Array.isArray(data.trackedDates[dayKey])
		? data.trackedDates[dayKey].map(entry => ({ ...entry }))
		: [];

	if (s.isDateBefore(data.trackedSnapshotDate, dayKey)) {
		data.trackedBaselineSnapshot = previousSnapshot ?? previousBaseline ?? "";
		data.trackedBaselineDate = data.trackedSnapshotDate;
	}

	if (data.trackedBaselineSnapshot == null) {
		data.trackedBaselineSnapshot = previousSnapshot ?? currentContent;
		data.trackedBaselineDate = data.trackedSnapshotDate ?? dayKey;
	}

	const baselineSnapshot = stripForTracking(data.trackedBaselineSnapshot);
	let entries: FileDateEntry[] = [];
	if (baselineSnapshot !== null) {
		entries = buildTrackedEntriesFromDiff({
			filePath: file.path,
			today: dayKey,
			baseline: baselineSnapshot,
			current: currentContent,
			currentLines: lines,
			summarize: (_change, filePath, text) => {
				if (describedSummary) return describedSummary;
				return resolveSummaryForFile(s.plugin, filePath, text, { includeFileName: false });
			},
			hashText: text => hashText(text)
		});
		if (snapshotsEqual(baselineSnapshot, currentContent)) {
			entries = [];
			data.trackedSnapshot = currentContent;
			data.trackedSnapshotDate = dayKey;
			data.trackedBaselineSnapshot = currentContent;
			data.trackedBaselineDate = dayKey;
		}
	}

	if (entries.length > 0) {
		const previousByTrackedKey = new Map(
			previousEntries.map(entry => [trackedEntryKey(entry), entry] as const)
		);
		const continuingEntries: FileDateEntry[] = [];
		const freshEntries: FileDateEntry[] = [];
		for (const entry of entries) {
			const key = trackedEntryKey(entry);
			const existing = previousByTrackedKey.get(key);
			if (existing && trackedEntriesEquivalent(existing, entry)) {
				const preserved =
					existing.trackedTime != null
						? { ...entry, trackedTime: existing.trackedTime }
						: entry;
				continuingEntries.push(preserved);
				previousByTrackedKey.delete(key);
				continue;
			}
			freshEntries.push(entry);
		}
		const orderedEntries = continuingEntries.concat(freshEntries);
		const previousTimes = previousEntries
			.map(entry => Date.parse(entry.trackedTime ?? ""))
			.filter((value): value is number => Number.isFinite(value));
		let timestampBase = Date.now();
		if (previousTimes.length > 0) {
			const maxPrevious = Math.max(...previousTimes);
			if (!Number.isFinite(timestampBase) || timestampBase <= maxPrevious) {
				timestampBase = maxPrevious + 1;
			}
		}
		let timestampIncrement = 0;
		data.trackedDates[dayKey] = orderedEntries.map(entry => {
			if (entry.trackedTime != null) {
				return entry;
			}
			const trackedTime = new Date(timestampBase + timestampIncrement++).toISOString();
			return { ...entry, trackedTime };
		});
	} else {
		delete data.trackedDates[dayKey];
	}

	data.trackedSnapshot = currentContent;
	data.trackedSnapshotDate = dayKey;
}
