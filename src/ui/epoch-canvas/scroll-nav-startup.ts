import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";

import { dateKeyToDate as dateKeyToDateHelper, getDayIndexForDate as getDayIndexForDateHelper } from "../epoch-canvas-focus";
import { getEntriesForDate, pickEntryForFile } from "../entry-helpers";

type StartupScrollNavCanvasState = {
	index: Record<string, DateEntry[]>;
	layouts: Array<{ summaryRects?: Array<{ entry?: DateEntry | null }> }>;
	scrollNavFile: string | null;
	scrollNavIndex: number;
	pendingScrollNavHighlight: unknown;
	showContentDates?: boolean;
	showPropDates?: boolean;
	showAttachments?: boolean;
	reviewFilterMode?: string;
	showDraftOnly?: boolean;
	showHidden?: boolean;
	root?: HTMLElement;
	clearHover(force?: boolean): void;
	draw(): void;
	recurring?: unknown;
	scrollNavAnchorEntry?: DateEntry | null;
	__scrollNavLastModeKey?: string | null;
	__scrollNavAnchorMode?: string | null;
};

function state(canvas: EpochCanvas): StartupScrollNavCanvasState {
	return canvas as unknown as StartupScrollNavCanvasState;
}

function entryFile(entry: DateEntry): string {
	return String(entry.file ?? "");
}

function entryBlockStart(entry: DateEntry): number {
	return Number(entry.blockStart ?? -1);
}

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

function entriesMatch(a: DateEntry, b: DateEntry): boolean {
	if (a === b) return true;
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
	const c = state(canvas);
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
		const picked = pickEntryForFile(canvas, entries, path, null);
		if (!picked) continue;
		const dayIndex0 = getDayIndexForDateHelper(canvas, date);
		const dayIndex = Number.isFinite(dayIndex0) ? dayIndex0 : Number.POSITIVE_INFINITY;
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
		matches.push({ date, dayIndex, entryIndex, entry: picked });
	}

	matches.sort((a, b) => {
		const di = a.dayIndex - b.dayIndex;
		if (di !== 0) return di;
		const ei = a.entryIndex - b.entryIndex;
		if (ei !== 0) return ei;
		const af = entryFile(a.entry);
		const bf = entryFile(b.entry);
		if (af < bf) return -1;
		if (af > bf) return 1;
		const abs = entryBlockStart(a.entry);
		const bbs = entryBlockStart(b.entry);
		return abs - bbs;
	});

	if (matches.length === 0) {
		c.scrollNavIndex = -1;
		return false;
	}

	let preferredEntry: DateEntry | null = null;
	if (typeof cursorLine === "number" && Number.isFinite(cursorLine)) {
		for (const layout of c.layouts ?? []) {
			const rects = layout.summaryRects ?? [];
			if (rects.length === 0) continue;
			const hit = rects.find((r) => {
				const e = r?.entry;
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
		chosenIndex = matches.findIndex((m) => entriesMatch(m.entry, preferredEntry));
		if (chosenIndex >= 0) {
			c.scrollNavIndex = chosenIndex;
			return true;
		}
	}

	const isRecurring = (entry: DateEntry): boolean => entry.recurring === true;
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
