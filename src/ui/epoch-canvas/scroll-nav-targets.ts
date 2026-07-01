import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import {
	dateKeyToDate as dateKeyToDateHelper,
	getDayIndexForDate as getDayIndexForDateHelper
} from "../epoch-canvas-focus";
import { getEntriesCountForDateFast, getEntriesForDate, pickEntryForFile } from "../entry-helpers";

type EpochBucket = "day" | "2days" | "4days" | "week" | "2weeks" | "month" | "3months" | "6months" | "year";

type EntryTarget = Extract<ScrollNavTarget, { kind: "entry" }>;

type ScrollNavTargetsState = {
	index?: Record<string, DateEntry[]>;
	epochsViewBucket?: string | null;
	epochsView?: boolean;
	searchQuery?: string;
	__indexVersion?: number;
	showAttachments?: boolean;
	showTrackedChanges?: boolean;
	showContentDates?: boolean;
	showHidden?: boolean;
	showDraftOnly?: boolean;
	__scrollNavVisibleTargetsSig?: string | null;
	__scrollNavVisibleTargets?: EntryTarget[] | null;
};

function state(canvas: EpochCanvas): ScrollNavTargetsState {
	return canvas as unknown as ScrollNavTargetsState;
}

function normalizeEpochBucket(value: unknown): EpochBucket | null {
	const bucket = typeof value === "string" ? value : "";
	return bucket === "day" ||
		bucket === "2days" ||
		bucket === "4days" ||
		bucket === "week" ||
		bucket === "2weeks" ||
		bucket === "month" ||
		bucket === "3months" ||
		bucket === "6months" ||
		bucket === "year"
		? bucket
		: null;
}

function entryKey(date: Date, entry: DateEntry): string {
	const d = date instanceof Date ? date.getTime() : 0;
	const file = String(entry.file ?? "");
	const source = String(entry.source ?? "");
	const bs = Number(entry.blockStart ?? -1);
	const be = Number(entry.blockEnd ?? -1);
	return `${d}|${file}|${source}|${bs}|${be}`;
}

export function computeScrollNavTargets(canvas: EpochCanvas, filePaths: string[]): ScrollNavTarget[] {
	const c = state(canvas);
	const targets: ScrollNavTarget[] = [{ kind: "today" }];
	const pathsRaw = Array.isArray(filePaths) ? filePaths.filter((p) => typeof p === "string" && !!p) : [];
	const paths: string[] = [];
	{
		const seen = new Set<string>();
		for (const p of pathsRaw) {
			if (!p) continue;
			if (seen.has(p)) continue;
			seen.add(p);
			paths.push(p);
		}
	}
	if (paths.length === 0) {
		return targets;
	}
	const matches: { date: Date; dayIndex: number; entryIndex: number; entry: DateEntry }[] = [];
	const seenEntryKeys = new Set<string>();
	for (const dateKey of Object.keys(c.index ?? {})) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const dayIndex = getDayIndexForDateHelper(canvas, date);
		const safeDayIndex = Number.isFinite(dayIndex) ? dayIndex : Number.POSITIVE_INFINITY;
		for (const p of paths) {
			const picked = pickEntryForFile(canvas, entries, p, null);
			if (!picked) continue;
			let entryIndex = entries.indexOf(picked);
			if (entryIndex < 0) {
				const pf = String(picked.file ?? "");
				const pbs = Number(picked.blockStart ?? -1);
				const pbe = Number(picked.blockEnd ?? -1);
				entryIndex = entries.findIndex((e) => {
					if (!e) return false;
					if (String(e.file ?? "") !== pf) return false;
					const ebs = Number(e.blockStart ?? -1);
					const ebe = Number(e.blockEnd ?? -1);
					return ebs === pbs && ebe === pbe;
				});
			}
			if (entryIndex < 0) continue;
			const key = entryKey(date, picked);
			if (seenEntryKeys.has(key)) continue;
			seenEntryKeys.add(key);
			matches.push({ date, dayIndex: safeDayIndex, entryIndex, entry: picked });
		}
	}
	matches.sort((a, b) => {
		const di = a.dayIndex - b.dayIndex;
		if (di !== 0) return di;
		const ei = a.entryIndex - b.entryIndex;
		if (ei !== 0) return ei;
		const af = String(a.entry.file ?? "");
		const bf = String(b.entry.file ?? "");
		if (af < bf) return -1;
		if (af > bf) return 1;
		const abs = Number(a.entry.blockStart ?? -1);
		const bbs = Number(b.entry.blockStart ?? -1);
		return abs - bbs;
	});
	for (const match of matches) {
		targets.push({ kind: "entry", date: match.date, entry: match.entry });
	}
	return targets;
}

export function computeVisibleScrollNavEntryTargets(canvas: EpochCanvas): EntryTarget[] {
	const c = state(canvas);
	const index = c.index ?? null;
	if (!index || typeof index !== "object") return [];

	const epochBucket = normalizeEpochBucket(c.epochsViewBucket ?? "");
	const epochBucketOpt = c.epochsView && epochBucket ? { epochBucket } : undefined;

	const sig = (() => {
		const q = String(c.searchQuery || "").trim().toLowerCase();
		const parts = [
			`v:${Number(c.__indexVersion) || 0}`,
			`Q:${q}`,
			`A:${c.showAttachments ? 1 : 0}`,
			`T:${c.showTrackedChanges ? 1 : 0}`,
			`C:${c.showContentDates ? 1 : 0}`,
			`H:${c.showHidden ? 1 : 0}`,
			`D:${c.showDraftOnly ? 1 : 0}`,
			`E:${c.epochsView ? 1 : 0}`,
			`B:${String(c.epochsViewBucket || "")}`
		];
		return parts.join("|");
	})();
	try {
		const prevSig = String(c.__scrollNavVisibleTargetsSig ?? "");
		const prev = c.__scrollNavVisibleTargets;
		if (prevSig === sig && Array.isArray(prev)) {
			return prev;
		}
	} catch {
		// ignore
	}

	const days: Array<{ dayIndex: number; date: Date }> = [];
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date, epochBucketOpt);
		if (!entries || entries.length === 0) continue;
		const dayIndexRaw = getDayIndexForDateHelper(canvas, date);
		const dayIndex = Number.isFinite(dayIndexRaw) ? Number(dayIndexRaw) : Number.POSITIVE_INFINITY;
		days.push({ dayIndex, date });
	}
	days.sort((a, b) => {
		const di = a.dayIndex - b.dayIndex;
		if (di !== 0) return di;
		return a.date.getTime() - b.date.getTime();
	});

	const out: EntryTarget[] = [];
	const seen = new Set<string>();

	for (const { date } of days) {
		const entries = getEntriesForDate(canvas, date, epochBucketOpt);
		if (!entries || entries.length === 0) continue;
		for (const entry of entries) {
			if (!entry) continue;
			const key = entryKey(date, entry);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ kind: "entry", date, entry });
		}
	}

	try {
		c.__scrollNavVisibleTargetsSig = sig;
		c.__scrollNavVisibleTargets = out;
	} catch {
		// ignore
	}

	return out;
}

export function computeVisibleScrollNavDayTargets(canvas: EpochCanvas): Array<{ dayIndex: number; date: Date }> {
	const c = state(canvas);
	const index = c.index ?? null;
	if (!index || typeof index !== "object") return [];

	const epochBucket = normalizeEpochBucket(c.epochsViewBucket ?? "");

	const days: Array<{ dayIndex: number; date: Date }> = [];
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const options = epochBucket ? { epochBucket } : undefined;
		const count = getEntriesCountForDateFast(canvas, date, options);
		if (!Number.isFinite(count) || count <= 0) continue;
		const dayIndexRaw = getDayIndexForDateHelper(canvas, date);
		const dayIndex = Number.isFinite(dayIndexRaw) ? Number(dayIndexRaw) : Number.POSITIVE_INFINITY;
		days.push({ dayIndex, date });
	}
	days.sort((a, b) => {
		const di = a.dayIndex - b.dayIndex;
		if (di !== 0) return di;
		return a.date.getTime() - b.date.getTime();
	});
	return days;
}
