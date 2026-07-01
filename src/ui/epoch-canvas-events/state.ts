import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import type { DayLayout } from "../epoch-canvas-types";

export interface CanvasEventInternals {
	canvas: HTMLCanvasElement;
	root: HTMLElement;
	scale: number;
	offsetY: number;
	viewInteractionUntil: number;
	animatingView: boolean;
	targetScale: number;
	targetOffsetY: number;
	// While zooming (wheel/pinch), ignore hover until the user moves the pointer again.
	suppressHoverUntil: number;
	suppressHoverUntilPointerMove: boolean;
	suppressClickUntil?: number;
	isDragging: boolean;
	dragStartY: number;
	dragStartOffsetY: number;
	dragSource: "mouse" | "touch" | null;
	mouseDownX: number;
	mouseDownY: number;
	mouseDownTime: number;
	mouseMoved: boolean;
	touchMode: "pan" | "pinch" | "hover" | "twofinger" | "entrydrag" | "swipehide" | null;
	touchStartX: number;
	touchStartY: number;
	touchStartOffsetY: number;
	touchStartTime: number;
	touchMoved: boolean;
	touchLongPressTimeout: number | null;
	pinchStartDist: number;
	pinchStartScale: number;
	pinchAnchorWorldY: number;
	twoFingerStartTime: number;
	twoFingerAnchorX: number;
	twoFingerAnchorY: number;
	twoFingerMoved: boolean;
	lastPanY: number;
	lastPanTime: number;
	velocityY: number;
	lastTapTime: number;
	lastTapX: number;
	lastTapY: number;
	keepHoverAfterMenu: boolean;
	entryDragActive?: boolean;
	entryDragEntry?: DateEntry | null;
	entryDragSource?: "mouse" | "touch" | null;
	entryDragTargetDayIndex?: number | null;
	entryDragLastClientX?: number;
	entryDragLastClientY?: number;
	entryDragLastLocalX?: number;
	entryDragLastLocalY?: number;
	entryDragGhost?: {
		img: HTMLCanvasElement;
		x: number;
		y: number;
		w: number;
		h: number;
		offsetX: number;
		offsetY: number;
	} | null;
	entryDragGhostSourceEntry?: DateEntry | null;
	entryDragGhostAttemptedAt?: number;
	entryDragAutoScrollRaf?: number | null;
	entryDragAutoScrollLastAt?: number;
	entryDragCandidateEntry?: DateEntry | null;
	entryDragCandidateStartX?: number;
	entryDragCandidateStartY?: number;
	hoverSummary: { dayIndex: number; itemIndex: number } | null;
	hoverDateIndex: number | null;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	animDateIndex: number | null;
	hoverTarget: number;
	keepHoverUntilPointerMove: boolean;
	lastPointerEvent: MouseEvent | null;
	layouts: DayLayout[];
	hoverPreviewKey: string | null;
	previewLockedUntilAltRelease: boolean;
	epochsView: boolean;
	pendingScrollNavHighlight: { dayIndex: number; entry: DateEntry; date: Date; attempts: number; startedAt: number } | null;
	touchHadMultipleTouches: boolean;
	draw(): void;
	updateHover(x: number, y: number): void;
	clearHover(force?: boolean): void;
	setHoverSummary(dayIndex: number, itemIndex: number, immediate?: boolean): void;
	exitEpochsViewAndFocusEpoch(entry: DateEntry): void;
	requestHoverAnimation(): void;
	findSummaryEntryAtPoint(x: number, y: number): DateEntry | null;
	findDayLayoutAtPoint(x: number, y: number): DayLayout | null;
	showSummaryMenu(entry: DateEntry, clientX: number, clientY: number): unknown;
	showDateMenu(dayIndex: number, clientX: number, clientY: number): void;
	toggleEmptyAreaView(): void;
	openEntry(entry: DateEntry, ev?: MouseEvent, suppressFocusHover?: boolean): Promise<void>;
	openDateNote(
		date: Date,
		ev?: MouseEvent,
		focus?: boolean,
		options?: { allowFallbackToFirstEntry?: boolean }
	): Promise<boolean>;
	createNoteForDate(date: Date, focus?: boolean): Promise<void>;
	animateToToday(): void;
	advanceScrollNav(direction?: number, options?: { wrap?: boolean }): boolean;
	resetScrollNavToToday(): void;
	getToday(): Date;
	getDateForIndex(index: number, today: Date): Date;
	isPointerDeviceEvent(): boolean;
	attemptHoverPreview(e: MouseEvent): void;
	startInertia(): void;
	animatingWheelPan?: boolean;
	animatingWheelZoom?: boolean;
	wheelZoomDir?: number;
	__suppressExternalAutoScrollUntil?: number;
	scrollNavAnchorEntry?: DateEntry | null;
	scrollNavAnchorDayIndex?: number | null;
	suppressNextFocusScrollForPath?(path: string | null): void;
}

export function getEventState(canvas: EpochCanvas): CanvasEventInternals {
	return canvas as unknown as CanvasEventInternals;
}

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

export function isWheelInteractionSuppressed(state: CanvasEventInternals, now: number = nowMs()): boolean {
	const suppressClickUntil = Number(state.suppressClickUntil ?? 0);
	if (Number.isFinite(suppressClickUntil) && suppressClickUntil > 0 && now < suppressClickUntil) return true;
	return false;
}

export function isViewMotionActive(state: CanvasEventInternals): boolean {
	try {
		if (state.animatingView) return true;
		if (Math.abs(Number(state.velocityY) || 0) > 0.01) return true;
		if (state.animatingWheelPan) return true;
		if (state.animatingWheelZoom) return true;
	} catch {
		// ignore
	}
	return false;
}

export function stopViewMotion(state: CanvasEventInternals): void {
	try {
		state.velocityY = 0;
	} catch {
		// ignore
	}
	try {
		state.animatingView = false;
	} catch {
		// ignore
	}
	try {
		state.animatingWheelPan = false;
		state.animatingWheelZoom = false;
		state.wheelZoomDir = 0;
	} catch {
		// ignore
	}
	try {
		state.targetOffsetY = state.offsetY;
		state.targetScale = state.scale;
	} catch {
		// ignore
	}
}
