import type { EpochCanvas } from "../epoch-canvas";
import {
	BASE_SPACING,
	DAY_DOT_MIN_SCALE,
	MONTH_DOT_MIN_SCALE,
	MONTH_LABEL_MIN_SCALE,
	MS_PER_DAY,
	YEAR_LABEL_MIN_SCALE
} from "../epoch-canvas-constants";
import type { EpochBucketName } from "../epoch-canvas-constants";
import { getEntriesCountForDateFast } from "../entry-helpers";

function indexFromDate(today: Date, date: Date): number {
	const toUtcMidnight = (dt: Date): number => Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate());
	return Math.round((toUtcMidnight(today) - toUtcMidnight(date)) / MS_PER_DAY);
}

function parseDateKey(dateKey: string): Date | null {
	const parts = String(dateKey).split("-");
	if (parts.length !== 3) return null;
	const y = Number(parts[0]);
	const m = Number(parts[1]);
	const d = Number(parts[2]);
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
	const dt = new Date(y, m - 1, d);
	return Number.isFinite(dt.getTime()) ? dt : null;
}

export function buildRenderIndices(params: {
	today: Date;
	getDateForIndex: (index: number, today: Date) => Date;
	minIndex: number;
	maxIndex: number;
	scale: number;
}): number[] {
	const { today, getDateForIndex, minIndex, maxIndex, scale } = params;
	const daySpacingPx = BASE_SPACING * scale;
	const minPx = 1;
	const step = Math.max(1, Math.ceil(minPx / Math.max(0.000001, daySpacingPx)));

	const start = Math.floor(minIndex / step) * step;
	const out = new Set<number>();
	for (let i = start; i <= maxIndex; i += step) {
		if (i < minIndex) continue;
		out.add(i);
	}
	if (0 >= minIndex && 0 <= maxIndex) out.add(0);

	// Ensure month/year boundaries are included so date markers remain meaningful.
	const dateA = getDateForIndex(minIndex, today);
	const dateB = getDateForIndex(maxIndex, today);
	const t0 = Math.min(dateA.getTime(), dateB.getTime());
	const t1 = Math.max(dateA.getTime(), dateB.getTime());
	const startDate = new Date(t0);
	const endDate = new Date(t1);
	startDate.setHours(0, 0, 0, 0);
	endDate.setHours(0, 0, 0, 0);

	// If day dots/labels are effectively off, prioritize month/year starts.
	const includeMonths = scale < DAY_DOT_MIN_SCALE || scale < MONTH_LABEL_MIN_SCALE;
	const includeYears = scale < MONTH_DOT_MIN_SCALE || scale < YEAR_LABEL_MIN_SCALE;

	if (includeMonths || includeYears) {
		// Month starts
		if (includeMonths) {
			const cursor = new Date(startDate);
			cursor.setDate(1);
			cursor.setHours(0, 0, 0, 0);
			if (cursor.getTime() < startDate.getTime()) {
				cursor.setMonth(cursor.getMonth() + 1);
			}
			while (cursor.getTime() <= endDate.getTime()) {
				const idx = indexFromDate(today, cursor);
				if (idx >= minIndex && idx <= maxIndex) out.add(idx);
				cursor.setMonth(cursor.getMonth() + 1);
				cursor.setDate(1);
				cursor.setHours(0, 0, 0, 0);
			}
		}
		// Year starts
		if (includeYears) {
			const cursor = new Date(startDate);
			cursor.setMonth(0, 1);
			cursor.setHours(0, 0, 0, 0);
			if (cursor.getTime() < startDate.getTime()) {
				cursor.setFullYear(cursor.getFullYear() + 1);
				cursor.setMonth(0, 1);
				cursor.setHours(0, 0, 0, 0);
			}
			while (cursor.getTime() <= endDate.getTime()) {
				const idx = indexFromDate(today, cursor);
				if (idx >= minIndex && idx <= maxIndex) out.add(idx);
				cursor.setFullYear(cursor.getFullYear() + 1);
				cursor.setMonth(0, 1);
				cursor.setHours(0, 0, 0, 0);
			}
		}
	}

	return Array.from(out).sort((a, b) => a - b);
}

export function getEpochEntryIndicesInRange(params: {
	canvas: EpochCanvas;
	anyS: any;
	today: Date;
	epochBucket: EpochBucketName | null;
	minIndex: number;
	maxIndex: number;
}): number[] {
	const { canvas, anyS, today, epochBucket, minIndex, maxIndex } = params;
	const indexRef: any = (canvas as any)?.index;
	if (!indexRef || typeof indexRef !== "object") return [];

	const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const cacheRef = (anyS as any).__epochIndexCacheRef;
	const cacheTodayKey = (anyS as any).__epochIndexCacheTodayKey;
	if (cacheRef !== indexRef || cacheTodayKey !== todayKey || !(anyS as any).__epochIndexCacheByBucket) {
		const byBucket = new Map<string, number[]>();
		const seenByBucket = new Map<string, Set<number>>();

		const add = (bucket: string, idx: number): void => {
			if (idx < minIndex || idx > maxIndex) {
				// Still cache out-of-range indices; range changes with pan/zoom.
			}
			let seen = seenByBucket.get(bucket);
			if (!seen) {
				seen = new Set();
				seenByBucket.set(bucket, seen);
			}
			if (seen.has(idx)) return;
			seen.add(idx);
			let arr = byBucket.get(bucket);
			if (!arr) {
				arr = [];
				byBucket.set(bucket, arr);
			}
			arr.push(idx);
		};

		for (const [dateKey, entries] of Object.entries(indexRef)) {
			if (!Array.isArray(entries) || entries.length === 0) continue;
			const d = parseDateKey(dateKey);
			if (!d) continue;
			const idx = indexFromDate(today, d);

			let hasAnyEpoch = false;
			for (const e of entries) {
				if (!e) continue;
				const anyE: any = e as any;
				if (!String(anyE?.file || "").startsWith("epoch://")) continue;
				hasAnyEpoch = true;
				const b = String(anyE?.epochBucket || "");
				if (b) add(b, idx);
			}
			if (hasAnyEpoch) {
				add("__any__", idx);
			}
		}

		for (const [, arr] of byBucket.entries()) {
			arr.sort((a, b) => a - b);
			let write = 0;
			for (let i = 0; i < arr.length; i++) {
				if (i === 0 || arr[i] !== arr[i - 1]) arr[write++] = arr[i]!;
			}
			arr.length = write;
		}

		(anyS as any).__epochIndexCacheRef = indexRef;
		(anyS as any).__epochIndexCacheTodayKey = todayKey;
		(anyS as any).__epochIndexCacheByBucket = byBucket;
	}

	const byBucket: Map<string, number[]> | null = (anyS as any).__epochIndexCacheByBucket ?? null;
	if (!byBucket) return [];

	const key = epochBucket ? String(epochBucket) : "__any__";
	const arr = byBucket.get(key) ?? byBucket.get("__any__") ?? [];
	if (!arr.length) return [];

	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (arr[mid]! < minIndex) lo = mid + 1;
		else hi = mid;
	}
	const out: number[] = [];
	for (let i = lo; i < arr.length; i++) {
		const idx = arr[i]!;
		if (idx > maxIndex) break;
		out.push(idx);
	}
	return out;
}

export function getEntryIndicesWithAnyRecordsInRange(params: {
	canvas: EpochCanvas;
	anyS: any;
	today: Date;
	minIndex: number;
	maxIndex: number;
}): number[] {
	const { canvas, anyS, today, minIndex, maxIndex } = params;
	const indexRef: any = (canvas as any)?.index;
	if (!indexRef || typeof indexRef !== "object") return [];

	const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const filterKey = (() => {
		try {
			const c: any = canvas as any;
			const showAttachments = c?.showAttachments ? 1 : 0;
			const showTrackedChanges = c?.showTrackedChanges ? 1 : 0;
			const showHidden = c?.showHidden ? 1 : 0;
			const showDraftOnly = c?.showDraftOnly ? 1 : 0;
			const showContentDates = c?.showContentDates ? 1 : 0;
			const showPropDates = c?.showPropDates ? 1 : 0;
			const epochsView = c?.epochsView ? 1 : 0;
			return `${showAttachments}${showTrackedChanges}${showHidden}${showDraftOnly}${showContentDates}${showPropDates}|${epochsView}`;
		} catch {
			return "";
		}
	})();

	const cacheRef = (anyS as any).__entryIndexCacheRef;
	const cacheTodayKey = (anyS as any).__entryIndexCacheTodayKey;
	const cacheFilterKey = (anyS as any).__entryIndexCacheFilterKey;
	if (cacheRef !== indexRef || cacheTodayKey !== todayKey || cacheFilterKey !== filterKey || !Array.isArray((anyS as any).__entryIndexCacheAll)) {
		const indices: number[] = [];
		for (const dateKey of Object.keys(indexRef)) {
			const dt = parseDateKey(dateKey);
			if (!dt) continue;
			// Respect current filters without allocating full entry arrays.
			if (getEntriesCountForDateFast(canvas, dt) <= 0) continue;
			indices.push(indexFromDate(today, dt));
		}
		indices.sort((a, b) => a - b);
		let write = 0;
		for (let i = 0; i < indices.length; i++) {
			if (i === 0 || indices[i] !== indices[i - 1]) indices[write++] = indices[i]!;
		}
		indices.length = write;

		(anyS as any).__entryIndexCacheRef = indexRef;
		(anyS as any).__entryIndexCacheTodayKey = todayKey;
		(anyS as any).__entryIndexCacheFilterKey = filterKey;
		(anyS as any).__entryIndexCacheAll = indices;
	}

	const indices: number[] = (anyS as any).__entryIndexCacheAll ?? [];
	if (!indices.length) return [];

	let lo = 0;
	let hi = indices.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (indices[mid]! < minIndex) lo = mid + 1;
		else hi = mid;
	}
	const out: number[] = [];
	for (let i = lo; i < indices.length; i++) {
		const idx = indices[i]!;
		if (idx > maxIndex) break;
		out.push(idx);
	}
	return out;
}

export function mergeSortedUnique(a: number[], b: number[]): number[] {
	if (!a.length) return b.slice();
	if (!b.length) return a.slice();
	const out: number[] = [];
	let i = 0;
	let j = 0;
	let last: number | null = null;
	while (i < a.length || j < b.length) {
		const av = i < a.length ? a[i]! : Infinity;
		const bv = j < b.length ? b[j]! : Infinity;
		const next = av <= bv ? av : bv;
		if (av <= bv) i++;
		if (bv <= av) j++;
		if (last === null || next !== last) {
			out.push(next);
			last = next;
		}
	}
	return out;
}
