import { BASE_SPACING } from "../epoch-canvas-constants";

type Ymd = { y: number; m: number; d: number };

const HARD_OLDER_BOUND: Ymd = { y: 1000, m: 1, d: 1 };
const HARD_NEWER_BOUND: Ymd = { y: 2100, m: 12, d: 31 };
const CORE_OLDER_BOUND: Ymd = { y: 1001, m: 1, d: 1 };
const CORE_NEWER_BOUND: Ymd = { y: 2099, m: 12, d: 31 };

function toUtcMidnightMs(d: Date): number {
	return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateFromYmd(ymd: Ymd): Date {
	return new Date(ymd.y, ymd.m - 1, ymd.d);
}

function dayIndexForDate(today: Date, date: Date): number {
	return Math.round((toUtcMidnightMs(today) - toUtcMidnightMs(date)) / (24 * 60 * 60 * 1000));
}

export type TimelineViewportBounds = {
	hardMinIndex: number;
	hardMaxIndex: number;
	coreMinIndex: number;
	coreMaxIndex: number;
};

export function getTimelineViewportBounds(today: Date): TimelineViewportBounds {
	const hardMinIndex = dayIndexForDate(today, dateFromYmd(HARD_NEWER_BOUND));
	const hardMaxIndex = dayIndexForDate(today, dateFromYmd(HARD_OLDER_BOUND));
	const coreMinIndex = dayIndexForDate(today, dateFromYmd(CORE_NEWER_BOUND));
	const coreMaxIndex = dayIndexForDate(today, dateFromYmd(CORE_OLDER_BOUND));
	return {
		hardMinIndex: Math.min(hardMinIndex, hardMaxIndex),
		hardMaxIndex: Math.max(hardMinIndex, hardMaxIndex),
		coreMinIndex: Math.min(coreMinIndex, coreMaxIndex),
		coreMaxIndex: Math.max(coreMinIndex, coreMaxIndex)
	};
}

export function resolveViewportHeight(root: HTMLElement | null | undefined, fallbackHeight?: number): number {
	try {
		const h = Number(root?.getBoundingClientRect?.().height ?? 0);
		if (Number.isFinite(h) && h > 0) return h;
	} catch {
		// ignore
	}
	const f = Number(fallbackHeight ?? 0);
	return Number.isFinite(f) && f > 0 ? f : 0;
}

export function clampTimelineOffsetToBounds(params: {
	offsetY: number;
	scale: number;
	viewportHeight: number;
	today: Date;
}): number {
	const offsetY = Number(params.offsetY);
	const scale = Number(params.scale);
	const viewportHeight = Number(params.viewportHeight);
	if (!Number.isFinite(offsetY) || !Number.isFinite(scale) || !Number.isFinite(viewportHeight)) return offsetY;
	if (scale <= 0 || viewportHeight <= 0) return offsetY;

	const bounds = getTimelineViewportBounds(params.today);
	const pxPerDay = BASE_SPACING * scale;
	if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return offsetY;

	const minOffset = viewportHeight - bounds.hardMaxIndex * pxPerDay;
	const maxOffset = -bounds.hardMinIndex * pxPerDay;
	if (!Number.isFinite(minOffset) || !Number.isFinite(maxOffset)) return offsetY;
	if (minOffset > maxOffset) return (minOffset + maxOffset) / 2;
	return Math.max(minOffset, Math.min(maxOffset, offsetY));
}
