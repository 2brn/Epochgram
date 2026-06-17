import {
	TFile,
	Platform,
	WorkspaceLeaf,
	HoverParent
} from "obsidian";
import type { EpochIndex, DateEntry } from "../indexer/types";

import { CanvasIconCache } from "./canvas-icon-cache";
import {
	focusToday as focusTodayHelper,
	snapToToday as snapToTodayHelper,
	focusFile as focusFileHelper,
	snapToFile as snapToFileHelper,
	focusSummaryForLine as focusSummaryForLineHelper,
	focusSummaryForEntry as focusSummaryForEntryHelper,
	setHoverSummary as setHoverSummaryHelper
} from "./epoch-canvas-focus";
import * as canvasEventHandlers from "./epoch-canvas-events";
import { canvasSetupMethods } from "./epoch-canvas-setup";
import {
	clearHover as clearHoverHelper,
	clearSummaryHover as clearSummaryHoverHelper,
	updateHover as updateHoverHelper,
	attemptHoverPreview as attemptHoverPreviewHelper,
	onWindowKeyDown as onWindowKeyDownHelper,
	onWindowKeyUp as onWindowKeyUpHelper,
	findSummaryEntryAtPoint as findSummaryEntryAtPointHelper,
	findDayLayoutAtPoint as findDayLayoutAtPointHelper
} from "./epoch-canvas-hover";
import {
	getToday as getTodayHelper,
	getDateForIndex as getDateForIndexHelper,
	getCssValue as getCssValueHelper,
	getEntryTitle as getEntryTitleHelper,
	getNoteNameForDate as getNoteNameForDateHelper,
	getNotePathParts as getNotePathPartsHelper,
	getFileForDate as getFileForDateHelper,
	makeNoteFileName as makeNoteFileNameHelper,
	buildNotePath as buildNotePathHelper,
	getUsableLeaf as getUsableLeafHelper
} from "./epoch-canvas-helpers";
import {
	createNoteForDate as createNoteForDateAction,
	openDateNote as openDateNoteAction,
	openEntry as openEntryAction,
	openFileAtLine as openFileAtLineAction,
	triggerMissingFileRebuild as triggerMissingFileRebuildAction
} from "./epoch-canvas-actions";
import {
	showDateMenu as showDateMenuAction,
	showSummaryMenu as showSummaryMenuAction,
	toggleEmptyAreaView as toggleEmptyAreaViewAction
} from "./epoch-canvas-menus";
import { drawCanvas } from "./epoch-canvas-draw";
import { runCanvasAnimation } from "./epoch-canvas-animate";

import {
	TODAY_OFFSET_Y_INITIAL,
} from "./epoch-canvas-constants";

import type { DayLayout, HoverOverlay } from "./epoch-canvas-types";

import {
	hasProAccess as hasProAccessHelper,
	requirePro as requireProHelper,
	refreshSemanticRelatedForActiveFile as refreshSemanticRelatedForActiveFileHelper,
	updatePathsWithEmbeddingTerm as updatePathsWithEmbeddingTermHelper,
	updatePathsWithClassifiedTerm as updatePathsWithClassifiedTermHelper,
	updateSemanticRelatedTermPaths as updateSemanticRelatedTermPathsHelper
} from "./epoch-canvas/semantic";
import {
	setEpochsView as setEpochsViewHelper,
	setEpochsViewWithToolbar as setEpochsViewWithToolbarHelper,
	exitEpochsViewAndFocusEpoch as exitEpochsViewAndFocusEpochHelper,
} from "./epoch-canvas/epochs-view";
import { refreshIndex as refreshIndexHelper } from "./epoch-canvas/index-refresh";
import {
	setShowTrackedChanges as setShowTrackedChangesHelper,
	setShowContentDates as setShowContentDatesHelper,
	setShowPropDates as setShowPropDatesHelper,
	setReviewFilterMode as setReviewFilterModeHelper,
	setShowAttachments as setShowAttachmentsHelper
} from "./epoch-canvas/filters";
import {
	suppressNextFocusScrollForPath as suppressNextFocusScrollForPathHelper,
	setActiveFile as setActiveFileHelper,
	clearFocusedEpochRange as clearFocusedEpochRangeHelper
} from "./epoch-canvas/active-file";
import {
	hasVisibleEntryForFile as hasVisibleEntryForFileHelper,
	processPendingScrollNavHighlight as processPendingScrollNavHighlightHelper,
	advanceScrollNav as advanceScrollNavHelper,
	resetScrollNavToToday as resetScrollNavToTodayHelper,
	focusFirstFilteredTimelineRecord as focusFirstFilteredTimelineRecordHelper,
	snapFirstFilteredTimelineRecord as snapFirstFilteredTimelineRecordHelper,
	focusFilteredTimelineRecordForFile as focusFilteredTimelineRecordForFileHelper
} from "./epoch-canvas/scroll-nav";
import {
	computeDateOverlayLabel as computeDateOverlayLabelHelper,
	getDateOverlayAnchorScreenY as getDateOverlayAnchorScreenYHelper,
	showDateOverlay as showDateOverlayHelper,
	hideDateOverlay as hideDateOverlayHelper,
	updateDateOverlay as updateDateOverlayHelper
} from "./epoch-canvas/overlay";
import { startPinFlyToToday as startPinFlyToTodayHelper } from "./epoch-canvas/pin-fly";
import { ensureSizeMatchesDisplay as ensureSizeMatchesDisplayHelper, scheduleResize as scheduleResizeHelper } from "./epoch-canvas/resize-handling";
import { getTodayOffset as getTodayOffsetHelper, scaleFont as scaleFontHelper } from "./epoch-canvas/metrics";
import { getScrollAnchorDayIndex as getScrollAnchorDayIndexHelper } from "./epoch-canvas/scroll-anchor";
import { resetScrollNavTargetState as resetScrollNavTargetStateHelper } from "./epoch-canvas/scroll-nav-reset";

export class EpochCanvas {
	private root: HTMLElement; private plugin: any;
	private canvas: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
	private scale = 1; private offsetY = TODAY_OFFSET_Y_INITIAL;
	private pendingInitialSnap: { path: string; line: number | null } | null = null;
	private isDragging = false; private dragStartY = 0; private dragStartOffsetY = 0;
	private mouseDownX = 0; private mouseDownY = 0; private mouseDownTime = 0; private mouseMoved = false;
	private touchMode: "pan" | "pinch" | "hover" | "twofinger" | "entrydrag" | null = null;
	private touchStartY = 0; private touchStartOffsetY = 0; private pinchStartDist = 0; private pinchStartScale = 1; private pinchAnchorWorldY = 0;
	private twoFingerStartTime = 0; private twoFingerAnchorX = 0; private twoFingerAnchorY = 0; private twoFingerMoved = false;
	private dragSource: "mouse" | "touch" | null = null;
	private entryDragActive = false;
	private entryDragEntry: DateEntry | null = null;
	private entryDragSource: "mouse" | "touch" | null = null;
	private entryDragTargetDayIndex: number | null = null;
	private entryDragLastClientX = 0;
	private entryDragLastClientY = 0;
	private entryDragLastLocalX = 0;
	private entryDragLastLocalY = 0;
	private entryDragGhost: {
		img: HTMLCanvasElement;
		x: number;
		y: number;
		w: number;
		h: number;
		offsetX: number;
		offsetY: number;
	} | null = null;
	private entryDragGhostSourceEntry: DateEntry | null = null;
	private entryDragGhostAttemptedAt = 0;
	private entryDragAutoScrollRaf: number | null = null;
	private entryDragAutoScrollLastAt = 0;
	private entryDragCandidateEntry: DateEntry | null = null;
	private entryDragCandidateStartX = 0;
	private entryDragCandidateStartY = 0;
	private touchStartX = 0; private touchStartTime = 0; private touchMoved = false; private touchHadMultipleTouches = false; private touchLongPressTimeout: number | null = null;
	private lastPanY = 0; private lastPanTime = 0; private velocityY = 0; private lastFrameTime: number | null = null;
	private index: EpochIndex = {};
	private layouts: DayLayout[] = [];
	private activeFilePath: string | null = null; private suppressNextFocusHover: string | null = null; private forceNextFocusHover: string | null = null; private lastFileLeaf: WorkspaceLeaf | null = null;
	private handleWheel = (e: WheelEvent) => canvasEventHandlers.handleWheel(this, e);
	private handleMouseDown = (e: MouseEvent) => canvasEventHandlers.handleMouseDown(this, e);
	private handleMouseMoveWindow = (e: MouseEvent) => canvasEventHandlers.handleMouseMove(this, e);
	private handleMouseUpWindow = () => canvasEventHandlers.handleMouseUp(this);
	private handleMouseMoveCanvas = (e: MouseEvent) => canvasEventHandlers.handleHoverMouse(this, e);
	private handleMouseLeaveCanvas = (e?: MouseEvent) => {
		// Mobile should not participate in mouse hover semantics. Some platforms emit
		// synthetic mouseleave after touch interactions, which can cause hover flicker.
		if (!this.isPointerDeviceEvent()) {
			return;
		}
		// Opening the context menu (or holding right-click) can move pointer capture
		// off the canvas and trigger mouseleave. Keep the current hover in that case.
		const rightHeld = !!(e && (e.buttons & 2));
		if ((this as any).keepHoverAfterMenu || rightHeld) {
			return;
		}
		// Click-to-open sets keepHoverUntilPointerMove, but we still want hover to clear
		// when the pointer actually leaves the canvas.
		this.keepHoverUntilPointerMove = false;
		this.clearHover(false);
	};
	private handleTouchStart = (e: TouchEvent) => canvasEventHandlers.handleTouchStart(this, e);
	private handleTouchMove = (e: TouchEvent) => canvasEventHandlers.handleTouchMove(this, e);
	private handleTouchEnd = (e: TouchEvent) => canvasEventHandlers.handleTouchEnd(this, e);
	private handleTouchCancel = (e: TouchEvent) => canvasEventHandlers.handleTouchCancel(this, e);
	private handleClick = (e: MouseEvent) => canvasEventHandlers.handleClick(this, e);
	private handleAuxClick = (e: MouseEvent) => canvasEventHandlers.handleAuxClick(this, e);
	private handleDblClick = (e: MouseEvent) => canvasEventHandlers.handleDoubleClick(this, e);
	private handleContextMenu = (e: MouseEvent) => canvasEventHandlers.handleContextMenu(this, e);
	private handleKeyDownWindow = (e: KeyboardEvent) => onWindowKeyDownHelper(this, e);
	private handleKeyUpWindow = (e: KeyboardEvent) => onWindowKeyUpHelper(this, e);
	private bind = canvasSetupMethods.bind.bind(this); private resize = canvasSetupMethods.resize.bind(this); private scheduleVisibilityCheck = canvasSetupMethods.scheduleVisibilityCheck.bind(this); public destroy = canvasSetupMethods.destroy.bind(this);
	private hoverDateIndex: number | null = null; private hoverSummary: { dayIndex: number; itemIndex: number } | null = null;
	private animDateIndex: number | null = null; private animSummary: { dayIndex: number; itemIndex: number } | null = null;
	private hoverAnim = 0; private hoverTarget = 0; private animFrame: number | null = null;
	private hoverOverlay: HoverOverlay | null = null; private focusClearHandle: number | null = null; private keepHoverUntilPointerMove = false;
	private cssCache: Record<string, string> = {}; private iconCache = new CanvasIconCache(); private lastVisibleEntryCount: number | null = null;
	private scrollNavIndex = -1; private scrollNavFile: string | null = null;
	private scrollNavAnchorEntry: import("../indexer/types").DateEntry | null = null;
	private scrollNavAnchorDayIndex: number | null = null;
	private pinFly: {
		img: HTMLCanvasElement;
		fromX: number;
		fromY: number;
		toX: number;
		toY: number;
		w: number;
		h: number;
		startAt: number;
		durationMs: number;
		t: number;
	} | null = null;
	private pinFlyOnDone: (() => void) | null = null;
	private dateOverlayEl: HTMLElement | null = null; private dateOverlayTimer: number | null = null; private lastDateOverlayValue: string | null = null;
	private lastOverlayOffsetY = Number.NaN; private lastOverlayScale = Number.NaN;
	private resizeObserver: ResizeObserver | null = null; private resizeScheduled = false; private lastCanvasWidth = 0; private lastCanvasHeight = 0;
	private win: Window | null = null;
	private postResizeTimeout1: number | null = null;
	private postResizeTimeout2: number | null = null;
	private sizePoller: number | null = null;
	private ensureSizeMatchesDisplay = () => ensureSizeMatchesDisplayHelper(this);
	private scheduleResize = () => scheduleResizeHelper(this);
	private animatingView = false; private targetScale = 1; private targetOffsetY = TODAY_OFFSET_Y_INITIAL;
	private viewInteractionUntil = 0;
	private suppressHoverUntil = 0; private suppressHoverUntilPointerMove = false;
	private lastTapTime = 0; private lastTapX = 0; private lastTapY = 0;
	private keepHoverAfterMenu = false;
	private reviewFilterMode: "reviewed+draft" | "draft" = "reviewed+draft";
	private showHidden = false; private showDraftOnly = false;
	private showAttachments = false;
	private showTrackedChanges = true; private showContentDates = true; private showPropDates = false;
	private epochsView = false; private focusedEpochRange: { start: string; end: string } | null = null;
	private searchQuery = "";
	public onAfterDraw: (() => void) | null = null;

	public setSearchQuery(query: string): void {
		const cAny: any = this as any;
		const next = String(query || "");
		if (String(cAny.searchQuery || "") === next) return;
		cAny.searchQuery = next;
		if (/[!$]similar\b/i.test(next)) {
			try {
				this.refreshSemanticRelatedForActiveFile(true);
			} catch {
				// ignore
			}
		}
		cAny.scrollNavFile = null;
		cAny.scrollNavIndex = -1;
		cAny.pendingScrollNavHighlight = null;
		cAny.scrollNavAnchorEntry = null;
		cAny.scrollNavAnchorDayIndex = null;
		try {
			cAny.__scrollNavAnchorMode = null;
		} catch {
			// ignore
		}
		cAny.clearHover(true);
		cAny.draw();
	}

	public getSearchQuery(): string {
		try {
			return String((this as any).searchQuery || "");
		} catch {
			return "";
		}
	}

	private clearFocusedEpochRange(): void {
		clearFocusedEpochRangeHelper(this);
	}
	private epochsViewBucket: string | null = null; private epochsViewPrevBucket: string | null = null; private epochsViewBucketAnimStart: number | null = null;
	private pendingVisibilityDraw = false; private visibilityRetryTimeout: number | null = null; private missingFileRebuildPending = false;
	private hoverParent: HoverParent | null = null; private hoverSourceId: string;
	private hoverPreviewKey: string | null = null; private lastPointerEvent: MouseEvent | null = null;
	private modKeyActive = false; private previewLockedNotified = false; private previewLockedUntilAltRelease = false;
	private pendingScrollNavHighlight: { dayIndex: number; entry: DateEntry; date: Date; attempts: number; startedAt: number } | null = null; private suppressNextFocusScroll: string | null = null;
	private semanticRelatedPaths: Set<string> | null = null; private semanticRelatedScored: Array<{ path: string; score: number }> | null = null;
	private semanticRelatedActiveTerm: string | null = null;
	private semanticRelatedTermPaths: Set<string> | null = null; private semanticRelatedTermLastUpdatedAt: number | null = null; private semanticRelatedTermLoadInFlight = false;
	private semanticRelatedRequestId = 0; private semanticRelatedLastThreshold: number | null = null; private semanticRelatedLastZeroShotMinScore: number | null = null;
	private semanticRelatedLastUseLinks: boolean | null = null; private semanticRelatedLastUseTags: boolean | null = null;
	private semanticRelatedLastTitleJwThreshold: number | null = null;
	private cachedPathsWithEmbeddingTerm: Set<string> | null = null; private cachedPathsWithClassifiedTerm: Set<string> | null = null; private cachedClassifiedTermLastUpdatedAt: number | null = null;

	public get pathsWithEmbeddingTerm(): Set<string> | null {
		return this.cachedPathsWithEmbeddingTerm;
	}

	public get pathsWithClassifiedTerm(): Set<string> | null {
		return this.cachedPathsWithClassifiedTerm;
	}

	private updatePathsWithEmbeddingTerm(): void { updatePathsWithEmbeddingTermHelper(this); }

	private updatePathsWithClassifiedTerm(force = false): boolean {
		return updatePathsWithClassifiedTermHelper(this, force);
	}

	private updateSemanticRelatedTermPaths(): void { updateSemanticRelatedTermPathsHelper(this); }

	public refreshSemanticRelatedForActiveFile(force: boolean = false): void {
		refreshSemanticRelatedForActiveFileHelper(this, force);
	}

	private hasProAccess(): boolean { return hasProAccessHelper(this); }

	private requirePro(feature: string): boolean { return requireProHelper(this, feature); }

	constructor(root: HTMLElement, plugin: any, hoverParent: HoverParent | null = null) {
		this.root = root;
		this.plugin = plugin;
		this.hoverParent = hoverParent;
		this.win = (root?.ownerDocument?.defaultView as any) ?? window;
		this.hoverSourceId = this.plugin?.manifest?.id ?? "epoch";

		this.canvas = root.createEl("canvas");
		const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			throw new Error("Epochgram: Unable to acquire canvas context");
		}
		this.ctx = ctx;
		this.activeFilePath = this.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
		this.dateOverlayEl = this.root.createDiv({ cls: "epoch-date-overlay" });
		this.lastOverlayOffsetY = this.offsetY;
		this.lastOverlayScale = this.scale;
		const initialOverlayLabel = this.computeDateOverlayLabel();
		if (initialOverlayLabel && this.dateOverlayEl) {
			this.dateOverlayEl.textContent = initialOverlayLabel;
			this.lastDateOverlayValue = initialOverlayLabel;
		}

		this.refreshIndex();
		this.bind();

		try {
			const w: any = (this as any).win ?? window;
			const ROCtor: any = w.ResizeObserver ?? (window as any).ResizeObserver;
			if (typeof ROCtor === "function") {
				const ro = new ROCtor(() => {
					this.scheduleResize();
				});
				this.resizeObserver = ro;
				ro.observe(this.root);
			}
		} catch {
			// ignore
		}

		try {
			const w: any = (this as any).win ?? window;
			w.addEventListener?.("resize", this.scheduleResize);
			w.visualViewport?.addEventListener?.("resize", this.scheduleResize);
		} catch {
			// ignore
		}

		// Backstop for maximize/popout flows that don't emit reliable resize events.
		try {
			const w: any = (this as any).win ?? window;
			this.sizePoller = w.setInterval(() => this.ensureSizeMatchesDisplay(), 300);
		} catch {
			// ignore
		}
	}

	public isEpochsViewActive(): boolean {
		return this.epochsView === true;
	}

	public setEpochsView(value: boolean): void { setEpochsViewHelper(this, value); }

	public setEpochsViewWithToolbar(value: boolean): void { setEpochsViewWithToolbarHelper(this, value); }

	public exitEpochsViewAndFocusEpoch(entry: DateEntry): void { exitEpochsViewAndFocusEpochHelper(this, entry); }

	public refreshIndex() { refreshIndexHelper(this); }

	public setShowTrackedChanges(show: boolean) { setShowTrackedChangesHelper(this, show); }

	public setShowContentDates(show: boolean) { setShowContentDatesHelper(this, show); }

	public setShowPropDates(show: boolean) { setShowPropDatesHelper(this, show); }

	public suppressNextFocusScrollForPath(path: string | null): void { suppressNextFocusScrollForPathHelper(this, path); }

	public setActiveFile(path: string | null, line: number | null = null, options?: { suppressFocus?: boolean }) { setActiveFileHelper(this, path, line, options); }

	public initSize() { this.resize(); }

	public snapInitialPosition(
		preferFilePath: string | null,
		line: number | null = null,
		options: { draw?: boolean } = {}
	): void {
		this.clearFocusedEpochRange();
		if (preferFilePath) {
			try {
				const rect = this.root?.getBoundingClientRect?.();
				if (!rect || !rect.width || !rect.height) {
					this.pendingInitialSnap = { path: preferFilePath, line };
					this.scheduleVisibilityCheck();
					return;
				}
			} catch {
				// ignore
			}
			const ok = snapToFileHelper(this, preferFilePath, line, { draw: options.draw !== false });
			if (ok) {
				this.pendingInitialSnap = null;
				return;
			}
		}
		this.pendingInitialSnap = null;
		snapToTodayHelper(this, { draw: options.draw !== false });
	}

	public hasVisibleEntryForFile(filePath: string | null | undefined, line: number | null = null): boolean {
		return hasVisibleEntryForFileHelper(this, filePath, line);
	}

	private processPendingScrollNavHighlight(): void { processPendingScrollNavHighlightHelper(this); }

	public advanceScrollNav(direction: number = 1, options: { wrap?: boolean } = {}): boolean {
		return advanceScrollNavHelper(this, direction, options);
	}

	public resetScrollNavToToday(): void { resetScrollNavToTodayHelper(this); }

	public focusFirstFilteredTimelineRecord(): boolean { return focusFirstFilteredTimelineRecordHelper(this); }

	public snapFirstFilteredTimelineRecord(options: { draw?: boolean } = {}): boolean {
		return snapFirstFilteredTimelineRecordHelper(this, options);
	}

	public focusFilteredTimelineRecordForFile(filePath: string): boolean {
		return focusFilteredTimelineRecordForFileHelper(this, filePath);
	}

	public refreshStyles() { this.draw(); }

	public startPinFlyToToday(entry: DateEntry, onDone?: () => void): boolean {
		return startPinFlyToTodayHelper(this, entry, onDone);
	}

	public setReviewFilterMode(mode: "reviewed+draft" | "draft") { setReviewFilterModeHelper(this, mode); }

	public isShowingHidden(): boolean {
		return this.showHidden;
	}

	private getTodayOffset(): number {
		return getTodayOffsetHelper(this);
	}

	public setShowAttachments(show: boolean) { setShowAttachmentsHelper(this, show); }

	private scaleFont(font: string, factor: number): string {
		return scaleFontHelper(font, factor);
	}

	focusToday() {
		this.clearFocusedEpochRange();
		resetScrollNavTargetStateHelper(this);
		focusTodayHelper(this);
	}

	private focusFile(filePath: string, line: number | null = null, useHoverHighlight: boolean = true): boolean { return focusFileHelper(this, filePath, line, useHoverHighlight); }

	private focusSummaryForLine(filePath: string, line: number, useHoverHighlight: boolean): boolean { return focusSummaryForLineHelper(this, filePath, line, useHoverHighlight); }

	private focusSummaryForEntry(layout: DayLayout, entry: DateEntry, useHoverHighlight: boolean): boolean { return focusSummaryForEntryHelper(this, layout, entry, useHoverHighlight); }

	private setHoverSummary(dayIndex: number, itemIndex: number, persistent: boolean = false) { setHoverSummaryHelper(this, dayIndex, itemIndex, persistent); }

	private async createNoteForDate(date: Date, focus: boolean = true) {
		this.clearFocusedEpochRange();
		await createNoteForDateAction(this, date, focus);
	}

	private async openDateNote(
		date: Date,
		ev?: MouseEvent,
		focus: boolean = true,
		options?: { allowFallbackToFirstEntry?: boolean }
	): Promise<boolean> {
		this.clearFocusedEpochRange();
		return openDateNoteAction(this, date, ev, focus, options);
	}

	private async openFileAtLine(filePath: string, line: number = 0, ev?: MouseEvent) {
		this.clearFocusedEpochRange();
		await openFileAtLineAction(this, filePath, line, ev);
	}

	private async openEntry(entry: DateEntry, ev?: MouseEvent, suppressFocusHover: boolean = false) {
		this.clearFocusedEpochRange();
		await openEntryAction(this, entry, ev, suppressFocusHover);
	}

	private async triggerMissingFileRebuild() {
		await triggerMissingFileRebuildAction(this);
	}

	private showSummaryMenu(entry: DateEntry, clientX: number, clientY: number) { return showSummaryMenuAction(this, entry, clientX, clientY); }

	private showDateMenu(dayIndex: number, clientX: number, clientY: number) { showDateMenuAction(this, dayIndex, clientX, clientY); }

	private toggleEmptyAreaView() { toggleEmptyAreaViewAction(this); }

	private startInertia() {
		if (this.plugin?.settings?.enableAnimation === false) {
			this.velocityY = 0;
			this.lastFrameTime = null;
			return;
		}
		if (Math.abs(this.velocityY) < 0.01) return;
		this.lastFrameTime = null;
		this.requestHoverAnimation();
	}

	private cancelFocusClear() {
		if (this.focusClearHandle != null) {
			window.clearTimeout(this.focusClearHandle);
			this.focusClearHandle = null;
		}
	}

	private clearSummaryHover(force: boolean = false) { clearSummaryHoverHelper(this, force); }

	private clearHover(force: boolean = false) { clearHoverHelper(this, force); }

	private updateHover(x: number, y: number) { updateHoverHelper(this, x, y); }

	private attemptHoverPreview(event: MouseEvent | null) { attemptHoverPreviewHelper(this, event); }

	private findSummaryEntryAtPoint(x: number, y: number): DateEntry | null { return findSummaryEntryAtPointHelper(this, x, y); }

	private findDayLayoutAtPoint(x: number, y: number): DayLayout | null { return findDayLayoutAtPointHelper(this, x, y); }

	private isPointerDeviceEvent(): boolean {
		return !Platform.isMobileApp;
	}

	private getToday(): Date {
		return getTodayHelper();
	}

	private getDateForIndex(index: number, today: Date): Date {
		return getDateForIndexHelper(index, today);
	}

	private getCssValue(css: CSSStyleDeclaration, property: string): string { return getCssValueHelper(this, css, property); }

	private getEntryTitle(entry: DateEntry): string { return getEntryTitleHelper(this, entry); }

	private getNoteNameForDate(date: Date): string { return getNoteNameForDateHelper(this, date); }

	private getNotePathParts(date: Date): { folder: string; baseName: string } { return getNotePathPartsHelper(this, date); }

	private getFileForDate(date: Date): TFile | null { return getFileForDateHelper(this, date); }

	private makeNoteFileName(baseName: string, suffix: string = ""): string { return makeNoteFileNameHelper(baseName, suffix); }

	private buildNotePath(folder: string, baseName: string, suffix: string = ""): string { return buildNotePathHelper(folder, baseName, suffix); }

	private getUsableLeaf(candidate: WorkspaceLeaf | null | undefined): WorkspaceLeaf | null { return getUsableLeafHelper(this, candidate); }

	private requestHoverAnimation() {
		if (this.animFrame != null) return;
		this.animFrame = window.requestAnimationFrame(() => this.animate());
	}

	private animate() {
		runCanvasAnimation(this);
	}

	public getScrollAnchorDayIndex(): number | null {
		return getScrollAnchorDayIndexHelper(this);
	}

	private animateToToday() {
		this.targetScale = 1;
		this.targetOffsetY = this.getTodayOffset();
		const animationsEnabled = this.plugin?.settings?.enableAnimation !== false;
		if (!animationsEnabled) {
			this.scale = this.targetScale;
			this.offsetY = this.targetOffsetY;
			this.animatingView = false;
			this.draw();
			return;
		}
		this.animatingView = true;
		this.requestHoverAnimation();
	}

	private draw() {
		try {
			const indexer: any = this.plugin?.indexer;
			if (indexer?.refreshSyntheticEntriesIfDayChanged?.()) {
				const nextIndex = indexer.index as EpochIndex;
				this.index = nextIndex ? { ...nextIndex } : {};
				const anyThis: any = this as any;
				anyThis.__indexVersion = (Number(anyThis.__indexVersion) || 0) + 1;
				anyThis.__scrollNavVisibleTargetsSig = null;
				anyThis.__scrollNavVisibleTargets = null;
			}
			if (this.pendingInitialSnap) {
				const rect = this.root?.getBoundingClientRect?.();
				if (rect && rect.width && rect.height) {
					const pending = this.pendingInitialSnap;
					const ok = snapToFileHelper(this, pending.path, pending.line, { draw: false });
					if (ok) {
						this.pendingInitialSnap = null;
					}
				}
			}
		} catch {
			// ignore
		}
		drawCanvas(this);
		this.updateDateOverlay();
		try {
			this.onAfterDraw?.();
		} catch {
			// ignore
		}
	}

	private computeDateOverlayLabel(): string | null { return computeDateOverlayLabelHelper(this); }

	private getDateOverlayAnchorScreenY(): number { return getDateOverlayAnchorScreenYHelper(this); }

	private showDateOverlay(): void { showDateOverlayHelper(this); }

	private hideDateOverlay(immediate: boolean = false): void { hideDateOverlayHelper(this, immediate); }

	private updateDateOverlay(): void { updateDateOverlayHelper(this); }
}
