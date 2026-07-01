import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import { focusDate as focusDateHelper } from "../epoch-canvas-focus";
import { resetScrollNavTargetState } from "./scroll-nav-reset";

type LayoutSummaryLike = {
	entry?: { file?: string; blockStart?: number; blockEnd?: number };
	y1?: number;
	y2?: number;
};

type LayoutLike = { summaryRects?: LayoutSummaryLike[] };

type ScrollNavCanvasState = {
	__forcedActiveFileCursorPath?: string | null;
	__forcedActiveFileCursorLine?: number | null;
	__forcedActiveFileCursorUntil?: number;
	animatingView?: boolean;
	pendingScrollNavHighlight?: { date: Date } | null;
	root: HTMLElement;
	layouts: LayoutLike[];
	activeFilePath?: string | null;
	scrollNavFile?: string | null;
	clearFocusedEpochRange(): void;
	animateToToday(): void;
};

function nowMs(): number {
	return Date.now();
}

export function navigateToEntryTarget(canvas: EpochCanvas, target: Extract<ScrollNavTarget, { kind: "entry" }>): void {
	const c = canvas as unknown as ScrollNavCanvasState;
	try {
		const path = String(target.entry?.file ?? "");
		const line0 = Number(target.entry?.blockStart ?? 0);
		const line = Number.isFinite(line0) ? Math.max(0, line0) : 0;
		if (path) {
			c.__forcedActiveFileCursorPath = path;
			c.__forcedActiveFileCursorLine = line;
			c.__forcedActiveFileCursorUntil = nowMs() + 15_000;
		}
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, target.date, true, true, true);
	c.pendingScrollNavHighlight = null;
}

export function processPendingScrollNavHighlight(canvas: EpochCanvas): void {
	const c = canvas as unknown as ScrollNavCanvasState;
	if (!c.pendingScrollNavHighlight) return;
	const { date } = c.pendingScrollNavHighlight;
	try {
		c.animatingView = true;
		focusDateHelper(canvas, date, true, true, true);
	} catch {
		// ignore
	}
	c.pendingScrollNavHighlight = null;
}

export function hasVisibleEntryForFile(
	canvas: EpochCanvas,
	filePath: string | null | undefined,
	line: number | null = null
): boolean {
	const c = canvas as unknown as ScrollNavCanvasState;
	if (!filePath) return false;
	const rect = c.root.getBoundingClientRect();
	const scrollPadding = 50;
	const topLimit = scrollPadding;
	const bottomLimit = rect.height - scrollPadding;
	const hasLine = typeof line === "number" && Number.isFinite(line);
	for (const layout of c.layouts) {
		if (!layout.summaryRects || layout.summaryRects.length === 0) continue;
		for (const summary of layout.summaryRects) {
			const entryFile = summary?.entry?.file;
			if (entryFile !== filePath) continue;
			if (hasLine) {
				const currentLine = typeof line === "number" ? line : 0;
				const entry = summary?.entry;
				const start0 = Number(entry?.blockStart ?? 0);
				const start = Number.isFinite(start0) ? start0 : 0;
				const end0 = Number(entry?.blockEnd ?? start);
				const end = Number.isFinite(end0) ? end0 : start;
				if (currentLine < start || currentLine > end) continue;
			}
			const y1 = Number(summary?.y1);
			const y2 = Number(summary?.y2);
			if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
			const top = Math.min(y1, y2);
			const bottom = Math.max(y1, y2);
			if (top >= topLimit && bottom < bottomLimit) {
				return true;
			}
		}
	}
	return false;
}

export function resetScrollNavToToday(canvas: EpochCanvas): void {
	const c = canvas as unknown as ScrollNavCanvasState;
	c.clearFocusedEpochRange();
	resetScrollNavTargetState(canvas);
	const filePath = c.activeFilePath ?? null;
	c.scrollNavFile = filePath;
	c.animateToToday();
}
