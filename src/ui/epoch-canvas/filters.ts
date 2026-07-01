import type { EpochCanvas } from "../epoch-canvas";

import { resetScrollNavTargetState } from "./scroll-nav-reset";

export type ReviewFilterMode = "reviewed+draft" | "draft";

type FilterCanvasState = {
	root: HTMLElement;
	showTrackedChanges: boolean;
	showContentDates: boolean;
	showPropDates: boolean;
	reviewFilterMode: ReviewFilterMode;
	showDraftOnly: boolean;
	showHidden: boolean;
	showAttachments: boolean;
	clearHover(force?: boolean): void;
	draw(): void;
	refreshSemanticRelatedForActiveFile?(force?: boolean): void;
	__scrollNavLastModeKey?: string | null;
	scrollNavFile: string | null;
};

function state(canvas: EpochCanvas): FilterCanvasState {
	return canvas as unknown as FilterCanvasState;
}

function normalizeReviewFilterMode(mode: unknown): ReviewFilterMode {
	if (mode === "draft" || mode === "reviewed+draft") return mode;
	return "reviewed+draft";
}

function resetScrollNavAfterViewChange(canvas: EpochCanvas): void {
	const c = state(canvas);
	resetScrollNavTargetState(canvas);
	c.scrollNavFile = null;
	try {
		c.__scrollNavLastModeKey = null;
	} catch {
		// ignore
	}
}

export function setShowTrackedChanges(canvas: EpochCanvas, show: boolean): void {
	const c = state(canvas);
	const next = !!show;
	if (c.showTrackedChanges === next) return;
	c.showTrackedChanges = next;
	c.root.classList.toggle("epoch-hide-tracked", !c.showTrackedChanges);
	resetScrollNavAfterViewChange(canvas);
	c.clearHover(true);
	c.draw();
}

export function setShowContentDates(canvas: EpochCanvas, show: boolean): void {
	const c = state(canvas);
	const next = !!show;
	if (c.showContentDates === next) return;
	c.showContentDates = next;
	c.root.classList.toggle("epoch-hide-content", !c.showContentDates);
	resetScrollNavAfterViewChange(canvas);
	c.clearHover(true);
	c.draw();
}

export function setShowPropDates(canvas: EpochCanvas, show: boolean): void {
	const c = state(canvas);
	const next = !!show;
	if (c.showPropDates === next) return;
	c.showPropDates = next;
	resetScrollNavAfterViewChange(canvas);
	c.clearHover(true);
	c.draw();
}

export function setReviewFilterMode(canvas: EpochCanvas, mode: ReviewFilterMode): void {
	const c = state(canvas);
	const nextMode = normalizeReviewFilterMode(mode);
	const prevMode = normalizeReviewFilterMode(c.reviewFilterMode);
	const nextShowDraftOnly = nextMode === "draft";

	if (
		prevMode === nextMode &&
		!!c.showDraftOnly === nextShowDraftOnly
	) {
		return;
	}

	c.reviewFilterMode = nextMode;
	c.showHidden = false;
	c.showDraftOnly = nextShowDraftOnly;
	c.root.classList.toggle("epoch-show-hidden", false);
	c.root.classList.toggle("epoch-filter-draft", c.showDraftOnly);
	resetScrollNavAfterViewChange(canvas);
	c.clearHover(true);
	c.draw();
}

export function setShowAttachments(canvas: EpochCanvas, show: boolean): void {
	const c = state(canvas);
	const next = !!show;
	if (c.showAttachments === next) return;
	c.showAttachments = next;
	c.root.classList.toggle("epoch-show-attachments", c.showAttachments);
	resetScrollNavAfterViewChange(canvas);
	try {
		c.refreshSemanticRelatedForActiveFile?.(true);
	} catch {
		// ignore
	}
	c.clearHover(true);
	c.draw();
}
