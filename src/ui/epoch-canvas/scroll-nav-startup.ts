import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import { dateKeyToDate as dateKeyToDateHelper, getDayIndexForDate as getDayIndexForDateHelper } from "../epoch-canvas-focus";
import { getEntriesForDate, pickEntryForFile } from "../entry-helpers";

function getSourcePriority(source: DateEntry["source"]): number {
	switch (source) {
		case "namedate":
			return 0;
		case "dateprop":
			return 1;
		case "cdate":
			return 2;
		case "content":
			return 3;
		case "tracked":
			return 4;
		default:
			return 10;
	}
}

function entriesMatch(a: any, b: any): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const af = String(a.file ?? "");
	const bf = String(b.file ?? "");
	if (af !== bf) return false;
	const as = String(a.source ?? "");
	const bs = String(b.source ?? "");
	if (as !== bs) return false;
	const abs = Number(a.blockStart ?? -1);
	const bbs = Number(b.blockStart ?? -1);
	if (abs !== bbs) return false;
	const abe = Number(a.blockEnd ?? -1);
	const bbe = Number(b.blockEnd ?? -1);
	return abe === bbe;
}

export function setScrollNavTargetForFile(canvas: EpochCanvas, filePath: string, cursorLine: number | null = null): boolean {
	const c: any = canvas as any;
	const path = String(filePath ?? "");
	if (!path) {
		c.scrollNavFile = null;
		c.scrollNavIndex = -1;
		c.pendingScrollNavHighlight = null;
		return false;
	}

	c.scrollNavFile = path;
	c.pendingScrollNavHighlight = null;

	const matches: { date: Date; dayIndex: number; entryIndex: number; entry: DateEntry }[] = [];
	for (const dateKey of Object.keys(c.index ?? {})) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const picked = pickEntryForFile(canvas, entries as any, path, null);
		if (!picked) continue;
		const dayIndex0 = getDayIndexForDateHelper(canvas, date);
		const dayIndex = Number.isFinite(dayIndex0) ? dayIndex0 : Number.POSITIVE_INFINITY;
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
		matches.push({ date, dayIndex, entryIndex, entry: picked });
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

	if (matches.length === 0) {
		c.scrollNavIndex = -1;
		return false;
	}

	let preferredEntry: DateEntry | null = null;
	if (typeof cursorLine === "number" && Number.isFinite(cursorLine)) {
		for (const layout of c.layouts ?? []) {
			const rects: any[] = (layout as any)?.summaryRects ?? [];
			if (!Array.isArray(rects) || rects.length === 0) continue;
			const hit = rects.find((r) => {
				const e = (r as any)?.entry;
				if (!e) return false;
				if (String(e.file ?? "") !== path) return false;
				const start0 = Number(e.blockStart ?? 0);
				const start = Number.isFinite(start0) ? start0 : 0;
				const end0 = Number(e.blockEnd ?? start);
				const end = Number.isFinite(end0) ? end0 : start;
				return cursorLine >= start && cursorLine <= end;
			});
			if (hit?.entry) {
				preferredEntry = hit.entry;
				break;
			}
		}
	}

	let chosenIndex = -1;
	if (preferredEntry) {
		chosenIndex = matches.findIndex((m) => entriesMatch(m.entry as any, preferredEntry as any));
		if (chosenIndex >= 0) {
			c.scrollNavIndex = chosenIndex;
			return true;
		}
	}

	const isRecurring = (entry: DateEntry): boolean => (entry as any)?.recurring === true;
	let bestAny: { priority: number; dateMs: number; idx: number } | null = null;
	let bestNonRecurring: { priority: number; dateMs: number; idx: number } | null = null;
	let oldestRecurring: { dateMs: number; idx: number } | null = null;
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i];
		const priority = getSourcePriority(m.entry.source);
		const dateMs = m.date.getTime();
		if (!bestAny || priority < bestAny.priority || (priority === bestAny.priority && dateMs > bestAny.dateMs)) {
			bestAny = { priority, dateMs, idx: i };
		}
		if (!isRecurring(m.entry)) {
			if (
				!bestNonRecurring ||
				priority < bestNonRecurring.priority ||
				(priority === bestNonRecurring.priority && dateMs > bestNonRecurring.dateMs)
			) {
				bestNonRecurring = { priority, dateMs, idx: i };
			}
		} else {
			if (!oldestRecurring || dateMs < oldestRecurring.dateMs) {
				oldestRecurring = { dateMs, idx: i };
			}
		}
	}
	const chosen = bestNonRecurring ?? oldestRecurring;
	if (!chosen) {
		c.scrollNavIndex = -1;
		return false;
	}
	c.scrollNavIndex = chosen.idx;
	return true;
}
