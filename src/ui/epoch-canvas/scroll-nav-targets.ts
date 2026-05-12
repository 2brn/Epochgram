import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import {
	dateKeyToDate as dateKeyToDateHelper,
	getDayIndexForDate as getDayIndexForDateHelper
} from "../epoch-canvas-focus";
import { getEntriesCountForDateFast, getEntriesForDate, pickEntryForFile } from "../entry-helpers";

export function computeScrollNavTargets(canvas: EpochCanvas, filePaths: string[]): ScrollNavTarget[] {
	const c: any = canvas as any;
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
	const entryKey = (date: Date, entry: DateEntry): string => {
		const d = date instanceof Date ? date.getTime() : 0;
		const file = String((entry as any)?.file ?? "");
		const source = String((entry as any)?.source ?? "");
		const bs = Number((entry as any)?.blockStart ?? -1);
		const be = Number((entry as any)?.blockEnd ?? -1);
		return `${d}|${file}|${source}|${bs}|${be}`;
	};
	for (const dateKey of Object.keys(c.index ?? {})) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const dayIndex = getDayIndexForDateHelper(canvas, date);
		const safeDayIndex = Number.isFinite(dayIndex) ? dayIndex : Number.POSITIVE_INFINITY;
		for (const p of paths) {
			const picked = pickEntryForFile(canvas, entries as any, p, null);
			if (!picked) continue;
			let entryIndex = (entries as any).indexOf(picked);
			if (entryIndex < 0) {
				const pf = String((picked as any)?.file ?? "");
				const pbs = Number((picked as any)?.blockStart ?? -1);
				const pbe = Number((picked as any)?.blockEnd ?? -1);
				entryIndex = (entries as any).findIndex((e: any) => {
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
		const af = String((a.entry as any)?.file ?? "");
		const bf = String((b.entry as any)?.file ?? "");
		if (af < bf) return -1;
		if (af > bf) return 1;
		const abs = Number((a.entry as any)?.blockStart ?? -1);
		const bbs = Number((b.entry as any)?.blockStart ?? -1);
		return abs - bbs;
	});
	for (const match of matches) {
		targets.push({ kind: "entry", date: match.date, entry: match.entry });
	}
	return targets;
}

export function computeVisibleScrollNavEntryTargets(canvas: EpochCanvas): Array<Extract<ScrollNavTarget, { kind: "entry" }>> {
	const c: any = canvas as any;
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return [];

	const epochBucketRaw = String(c.epochsViewBucket || "");
	const epochBucket = epochBucketRaw ? epochBucketRaw : null;
	const epochBucketOpt = c.epochsView && epochBucket ? ({ epochBucket } as any) : undefined;

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
		const prev = c.__scrollNavVisibleTargets as Array<Extract<ScrollNavTarget, { kind: "entry" }>> | null | undefined;
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

	const out: Array<Extract<ScrollNavTarget, { kind: "entry" }>> = [];
	const seen = new Set<string>();
	const entryKey = (date: Date, entry: DateEntry): string => {
		const d = date instanceof Date ? date.getTime() : 0;
		const file = String((entry as any)?.file ?? "");
		const source = String((entry as any)?.source ?? "");
		const bs = Number((entry as any)?.blockStart ?? -1);
		const be = Number((entry as any)?.blockEnd ?? -1);
		return `${d}|${file}|${source}|${bs}|${be}`;
	};

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
	const c: any = canvas as any;
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return [];

	const epochBucketRaw = String(c.epochsViewBucket || "");
	const epochBucket = epochBucketRaw ? epochBucketRaw : null;

	const days: Array<{ dayIndex: number; date: Date }> = [];
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const count = getEntriesCountForDateFast(canvas, date, epochBucket ? ({ epochBucket } as any) : undefined);
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
