import type { EpochCanvas } from "../epoch-canvas";
import type { CanvasHoverInternals } from "./types";

type HoverTransitionState = {
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	outgoingDates?: Array<{ index: number; t: number }> | null;
};

export function hoverState(canvas: EpochCanvas): CanvasHoverInternals {
	return canvas as unknown as CanvasHoverInternals;
}

export function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

export function pushOutgoingSummary(
	state: HoverTransitionState,
	summary: { dayIndex: number; itemIndex: number } | null,
	startT: number
): void {
	if (!summary) return;
	const t = clamp01(startT);
	if (t <= 0.001) return;
	let list = state.outgoingSummaries;
	if (!Array.isArray(list)) list = [];
	let merged = false;
	for (let i = 0; i < list.length; i++) {
		const o = list[i];
		if (!o) continue;
		if (o.dayIndex === summary.dayIndex && o.itemIndex === summary.itemIndex) {
			const prev = clamp01(Number(o.t));
			o.t = Math.max(prev, t);
			merged = true;
			break;
		}
	}
	if (!merged) {
		list.push({ dayIndex: summary.dayIndex, itemIndex: summary.itemIndex, t });
	}
	if (list.length > 8) {
		list.sort((a, b) => clamp01(Number(b.t)) - clamp01(Number(a.t)));
		list.length = 8;
	}
	state.outgoingSummaries = list;
}

export function takeOutgoingSummaryT(state: HoverTransitionState, summary: { dayIndex: number; itemIndex: number } | null): number {
	if (!summary) return 0;
	let list = state.outgoingSummaries;
	if (!Array.isArray(list) || list.length === 0) return 0;
	let best = 0;
	const next: Array<{ dayIndex: number; itemIndex: number; t: number }> = [];
	for (let i = 0; i < list.length; i++) {
		const o = list[i];
		if (!o) continue;
		if (o.dayIndex === summary.dayIndex && o.itemIndex === summary.itemIndex) {
			best = Math.max(best, clamp01(Number(o.t)));
			continue;
		}
		next.push(o);
	}
	state.outgoingSummaries = next;
	return best;
}

export function pushOutgoingDate(state: HoverTransitionState, index: number | null, startT: number): void {
	if (index == null) return;
	const t = clamp01(startT);
	if (t <= 0.001) return;
	let list = state.outgoingDates;
	if (!Array.isArray(list)) list = [];
	let merged = false;
	for (let i = 0; i < list.length; i++) {
		const o = list[i];
		if (!o) continue;
		if (o.index === index) {
			const prev = clamp01(Number(o.t));
			o.t = Math.max(prev, t);
			merged = true;
			break;
		}
	}
	if (!merged) {
		list.push({ index, t });
	}
	if (list.length > 8) {
		list.sort((a, b) => clamp01(Number(b.t)) - clamp01(Number(a.t)));
		list.length = 8;
	}
	state.outgoingDates = list;
}

export function takeOutgoingDateT(state: HoverTransitionState, index: number | null): number {
	if (index == null) return 0;
	let list = state.outgoingDates;
	if (!Array.isArray(list) || list.length === 0) return 0;
	let best = 0;
	const next: Array<{ index: number; t: number }> = [];
	for (let i = 0; i < list.length; i++) {
		const o = list[i];
		if (!o) continue;
		if (o.index === index) {
			best = Math.max(best, clamp01(Number(o.t)));
			continue;
		}
		next.push(o);
	}
	state.outgoingDates = next;
	return best;
}
