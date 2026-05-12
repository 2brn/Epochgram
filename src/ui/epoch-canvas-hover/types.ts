import type { HoverParent, TFile } from "obsidian";
import type { DateEntry } from "../../indexer/types";
import type { DayLayout, HoverOverlay } from "../epoch-canvas-types";
import type { EpochCanvas } from "../epoch-canvas";

export interface CanvasEventInternals {
	canvas: HTMLCanvasElement;
	root: HTMLElement;
	scale: number;
	offsetY: number;
	viewInteractionUntil: number;
	animatingView: boolean;
	targetScale: number;
	targetOffsetY: number;
	suppressHoverUntil: number;
	suppressHoverUntilPointerMove: boolean;
	isDragging: boolean;
	dragStartY: number;
	dragStartOffsetY: number;
	dragSource: "mouse" | "touch" | null;
	mouseDownX: number;
	mouseDownY: number;
	mouseDownTime: number;
	mouseMoved: boolean;
	touchMode: "pan" | "pinch" | "hover" | "twofinger" | null;
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
	pendingScrollNavHighlight: { dayIndex: number; entry: DateEntry; date: Date; attempts: number; startedAt: number } | null;
	touchHadMultipleTouches: boolean;
	draw(): void;
	updateHover(x: number, y: number): void;
	clearHover(force?: boolean): void;
	setHoverSummary(dayIndex: number, itemIndex: number, immediate?: boolean): void;
	requestHoverAnimation(): void;
	findSummaryEntryAtPoint(x: number, y: number): DateEntry | null;
	findDayLayoutAtPoint(x: number, y: number): DayLayout | null;
	showSummaryMenu(entry: DateEntry, clientX: number, clientY: number): void;
	showDateMenu(dayIndex: number, clientX: number, clientY: number): void;
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
}

export function state(canvas: EpochCanvas): CanvasEventInternals {
	return canvas as unknown as CanvasEventInternals;
}

export type HoverSummary = { dayIndex: number; itemIndex: number } | null;

export type HoverPreviewTarget = {
	file: TFile;
	sourcePath: string;
	key: string;
};

export interface CanvasHoverInternals {
	hoverSummary: HoverSummary;
	animSummary: HoverSummary;
	hoverOverlay: HoverOverlay | null;
	hoverPreviewKey: string | null;
	lastPointerEvent: MouseEvent | null;
	canvas: HTMLCanvasElement;
	requestHoverAnimation(): void;
	hoverDateIndex: number | null;
	animDateIndex: number | null;
	hoverTarget: number;
	keepHoverUntilPointerMove: boolean;
	suppressHoverUntil: number;
	suppressHoverUntilPointerMove: boolean;
	cancelFocusClear(): void;
	layouts: DayLayout[];
	hoverParent: HoverParent | null;
	plugin: any;
	hoverSourceId: string;
	activeFilePath: string | null;
	modKeyActive: boolean;
	previewLockedNotified: boolean;
	previewLockedUntilAltRelease: boolean;
	isPointerDeviceEvent(): boolean;
	isDragging: boolean;
	requirePro(feature: string): boolean;
	hasProAccess(): boolean;
	getDateForIndex(index: number, today: Date): Date;
	getToday(): Date;
	getFileForDate(date: Date): TFile | null;
}
