import type { DateEntry } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import { focusDate as focusDateHelper, getDayIndexForDate as getDayIndexForDateHelper } from "../epoch-canvas-focus";
import { BASE_SPACING } from "../epoch-canvas-constants";

export function advanceScrollNavEntries(params: {
	canvas: EpochCanvas;
	c: any;
	direction: number;
	wrap: boolean;
	prevPending: any;
	rect: DOMRect;
	targets: Array<Extract<ScrollNavTarget, { kind: "entry" }>>;
}): boolean {
	const { canvas, c, direction, wrap, prevPending, rect, targets } = params;

	if (targets.length === 0) {
		c.scrollNavIndex = -1;
		c.pendingScrollNavHighlight = null;
		return false;
	}

	const entriesMatch = (a: any, b: any): boolean => {
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
	};

	const dayTargets: Array<{ dayIndex: number; date: Date }> = (() => {
		const out: Array<{ dayIndex: number; date: Date }> = [];
		const seen = new Set<number>();
		for (const t of targets) {
			const di0 = getDayIndexForDateHelper(canvas, t.date);
			if (!Number.isFinite(di0)) continue;
			const di = Number(di0);
			if (seen.has(di)) continue;
			seen.add(di);
			out.push({ dayIndex: di, date: t.date });
		}
		out.sort((a, b) => a.dayIndex - b.dayIndex);
		return out;
	})();
	if (dayTargets.length === 0) {
		c.scrollNavIndex = -1;
		c.pendingScrollNavHighlight = null;
		return false;
	}
	if (dayTargets.length === 1) {
		const only = dayTargets[0]!;
		c.scrollNavIndex = 0;
		try {
			c.scrollNavAnchorEntry = null;
			c.scrollNavAnchorDayIndex = only.dayIndex;
		} catch {
			// ignore
		}
		c.animatingView = true;
		focusDateHelper(canvas, only.date, true, true, true);
		c.pendingScrollNavHighlight = null;
		return true;
	}

	let anchorDayIndex: number | null = null;
	let anchorFromFocus = false;
	if (prevPending && typeof prevPending.dayIndex === "number" && Number.isFinite(prevPending.dayIndex)) {
		anchorDayIndex = prevPending.dayIndex;
		anchorFromFocus = true;
		const idx = dayTargets.findIndex((d) => d.dayIndex === anchorDayIndex);
		if (idx >= 0) {
			c.scrollNavIndex = idx;
		}
	}
	if (anchorDayIndex == null) {
		const summaryFocus = c.hoverSummary ?? c.animSummary;
		if (summaryFocus && typeof summaryFocus.dayIndex === "number" && Number.isFinite(summaryFocus.dayIndex)) {
			anchorDayIndex = summaryFocus.dayIndex;
			anchorFromFocus = true;
		}
	}
	if (anchorDayIndex == null) {
		const dateFocus = c.hoverDateIndex ?? c.animDateIndex;
		if (dateFocus != null) {
			anchorDayIndex = dateFocus;
			anchorFromFocus = true;
		}
	}
	if (anchorDayIndex == null) {
		const anchoredDay: number | null =
			typeof c.scrollNavAnchorDayIndex === "number" && Number.isFinite(c.scrollNavAnchorDayIndex)
				? c.scrollNavAnchorDayIndex
				: null;
		if (anchoredDay != null) {
			anchorDayIndex = anchoredDay;
			anchorFromFocus = true;
		}
	}
	if (anchorDayIndex == null) {
		try {
			const anchoredEntry: DateEntry | null = (c.scrollNavAnchorEntry as any) ?? null;
			if (anchoredEntry) {
				let anchoredIndex = targets.findIndex((t) => t.entry === anchoredEntry);
				if (anchoredIndex < 0) {
					anchoredIndex = targets.findIndex((t) => entriesMatch(t.entry as any, anchoredEntry as any));
				}
				if (anchoredIndex >= 0) {
					const di0 = getDayIndexForDateHelper(canvas, targets[anchoredIndex]!.date);
					anchorDayIndex = Number.isFinite(di0) ? Number(di0) : null;
					anchorFromFocus = true;
					if (anchorDayIndex != null) {
						const idx = dayTargets.findIndex((d) => d.dayIndex === anchorDayIndex);
						if (idx >= 0) c.scrollNavIndex = idx;
					}
				}
			}
		} catch {
			// ignore
		}
	}
	if (
		anchorDayIndex == null &&
		typeof c.scrollNavIndex === "number" &&
		c.scrollNavIndex >= 0 &&
		c.scrollNavIndex < dayTargets.length
	) {
		anchorDayIndex = dayTargets[c.scrollNavIndex].dayIndex;
		anchorFromFocus = true;
	}
	if (anchorDayIndex == null) {
		let anchorScreenY = (() => {
			try {
				const y = (canvas as any)?.getTodayOffset?.();
				if (typeof y === "number" && Number.isFinite(y)) return y;
			} catch {
				// ignore
			}
			return rect.height * 0.33;
		})();
		try {
			if (String((c as any).__scrollNavAnchorMode || "") === "center") {
				anchorScreenY = rect.height / 2;
			}
		} catch {
			// ignore
		}
		const anchorWorldY = (anchorScreenY - c.offsetY) / c.scale;
		try {
			(c as any).__scrollNavAnchorMode = null;
		} catch {
			// ignore
		}
		if (!Number.isFinite(anchorWorldY)) {
			c.pendingScrollNavHighlight = null;
			return false;
		}
		anchorDayIndex = anchorWorldY / BASE_SPACING;
	}
	if (anchorDayIndex == null || !Number.isFinite(anchorDayIndex)) {
		c.pendingScrollNavHighlight = null;
		return false;
	}

	const anchorValue = anchorDayIndex;
	const allowEqual = !anchorFromFocus;
	let chosenIndex = -1;
	let chosenDiff = direction >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
	for (let i = 0; i < dayTargets.length; i++) {
		const pos = dayTargets[i]!.dayIndex;
		const diff = pos - anchorValue;
		if (direction >= 0) {
			if ((diff > 0 || (allowEqual && diff === 0)) && diff < chosenDiff) {
				chosenDiff = diff;
				chosenIndex = i;
			}
		} else if ((diff < 0 || (allowEqual && diff === 0)) && diff > chosenDiff) {
			chosenDiff = diff;
			chosenIndex = i;
		}
	}
	if (chosenIndex === -1) {
		if (!wrap) {
			if (typeof c.scrollNavIndex !== "number" || c.scrollNavIndex < 0 || c.scrollNavIndex >= dayTargets.length) {
				c.scrollNavIndex = direction >= 0 ? dayTargets.length - 1 : 0;
			}
			try {
				const boundaryIndex = direction >= 0 ? dayTargets.length - 1 : 0;
				const hoverGone =
					((c.hoverDateIndex == null && c.animDateIndex == null && c.hoverSummary == null && c.animSummary == null) ||
						Number(c.hoverTarget ?? 0) <= 0);
				if (c.scrollNavIndex === boundaryIndex && hoverGone) {
					const boundary = dayTargets[boundaryIndex]!;
					try {
						c.scrollNavAnchorEntry = null;
						c.scrollNavAnchorDayIndex = boundary.dayIndex;
					} catch {
						// ignore
					}
					c.animatingView = true;
					focusDateHelper(canvas, boundary.date, true, true, true);
					c.pendingScrollNavHighlight = null;
					return true;
				}
			} catch {
				// ignore
			}
			c.pendingScrollNavHighlight = null;
			return false;
		}
		c.scrollNavIndex = direction >= 0 ? 0 : dayTargets.length - 1;
		const wrapped = dayTargets[c.scrollNavIndex]!;
		try {
			c.scrollNavAnchorEntry = null;
			c.scrollNavAnchorDayIndex = wrapped.dayIndex;
		} catch {
			// ignore
		}
		c.animatingView = true;
		focusDateHelper(canvas, wrapped.date, true, true, true);
		c.pendingScrollNavHighlight = null;
		return true;
	}

	c.scrollNavIndex = chosenIndex;
	const target = dayTargets[chosenIndex]!;
	try {
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = target.dayIndex;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, target.date, true, true, true);
	c.pendingScrollNavHighlight = null;
	return true;
}
