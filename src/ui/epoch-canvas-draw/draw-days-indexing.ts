import type { EpochCanvas } from "../epoch-canvas";
import { BASE_SPACING, DAY_DOT_MIN_SCALE, MONTH_DOT_MIN_SCALE, MONTH_LABEL_MIN_SCALE, MS_PER_DAY, YEAR_LABEL_MIN_SCALE } from "../epoch-canvas-constants";
import { getEntriesCountForDateFast } from "../entry-helpers";
import type { CanvasDrawState } from "./state";
function indexFromDate(today: Date, date: Date): number {
	return Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / MS_PER_DAY);
}
function parseDateKey(key: string): Date | null {
	const parts = key.split("-").map(Number);
	if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
	const date = new Date(parts[0], parts[1] - 1, parts[2]);
	return Number.isFinite(date.getTime()) ? date : null;
}
export function buildRenderIndices(params: { today: Date; getDateForIndex: (index: number, today: Date) => Date; minIndex: number; maxIndex: number; scale: number }): number[] {
	const { today, getDateForIndex, minIndex, maxIndex, scale } = params;
	const step = Math.max(1, Math.ceil(1 / Math.max(0.000001, BASE_SPACING * scale)));
	const out = new Set<number>();
	for (let i = Math.floor(minIndex / step) * step; i <= maxIndex; i += step) if (i >= minIndex) out.add(i);
	if (minIndex <= 0 && maxIndex >= 0) out.add(0);
	const a = getDateForIndex(minIndex, today).getTime();
	const b = getDateForIndex(maxIndex, today).getTime();
	const start = new Date(Math.min(a, b)); start.setHours(0, 0, 0, 0);
	const end = new Date(Math.max(a, b)); end.setHours(0, 0, 0, 0);
	const addBoundary = (date: Date) => { const i = indexFromDate(today, date); if (i >= minIndex && i <= maxIndex) out.add(i); };
	if (scale < DAY_DOT_MIN_SCALE || scale < MONTH_LABEL_MIN_SCALE) {
		const cursor = new Date(start); cursor.setDate(1);
		if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
		while (cursor <= end) { addBoundary(cursor); cursor.setMonth(cursor.getMonth() + 1); cursor.setDate(1); }
	}
	if (scale < MONTH_DOT_MIN_SCALE || scale < YEAR_LABEL_MIN_SCALE) {
		const cursor = new Date(start); cursor.setMonth(0, 1);
		if (cursor < start) cursor.setFullYear(cursor.getFullYear() + 1);
		while (cursor <= end) { addBoundary(cursor); cursor.setFullYear(cursor.getFullYear() + 1); cursor.setMonth(0, 1); }
	}
	return Array.from(out).sort((a, b) => a - b);
}
export function getEntryIndicesWithAnyRecordsInRange(params: { canvas: EpochCanvas; anyS: CanvasDrawState; today: Date; minIndex: number; maxIndex: number }): number[] {
	const { canvas, anyS: s, today, minIndex, maxIndex } = params;
	const index = s.index;
	if (!index) return [];
	const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
	const filterKey = `${s.showAttachments}|${s.showContentDates}|${s.showPropDates}|${s.showDraftsOnly}|${s.searchQuery}`;
	if (s.__entryIndexCacheRef !== index || s.__entryIndexCacheTodayKey !== todayKey || s.__entryIndexCacheFilterKey !== filterKey || !s.__entryIndexCacheAll) {
		const indices = new Set<number>();
		for (const key of Object.keys(index)) { const date = parseDateKey(key); if (date && getEntriesCountForDateFast(canvas, date) > 0) indices.add(indexFromDate(today, date)); }
		s.__entryIndexCacheAll = Array.from(indices).sort((a, b) => a - b);
		s.__entryIndexCacheRef = index; s.__entryIndexCacheTodayKey = todayKey; s.__entryIndexCacheFilterKey = filterKey;
	}
	const indices = s.__entryIndexCacheAll;
	let lo = 0, hi = indices.length;
	while (lo < hi) { const mid = (lo + hi) >> 1; if (indices[mid] < minIndex) lo = mid + 1; else hi = mid; }
	const out: number[] = [];
	for (let i = lo; i < indices.length; i++) { const value = indices[i]; if (value > maxIndex) break; out.push(value); }
	return out;
}
export function mergeSortedUnique(a: number[], b: number[]): number[] {
	return Array.from(new Set([...a, ...b])).sort((a, b) => a - b);
}
