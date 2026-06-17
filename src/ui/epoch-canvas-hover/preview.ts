import { TFile, type HoverParent } from "obsidian";
import type { DateEntry } from "../../indexer/types";
import { HOVER_PREVIEW_RETRIGGER_DELAY_MS } from "../epoch-canvas-constants";
import type { EpochCanvas } from "../epoch-canvas";
import { getEntriesForDate as getEntriesForDateHelper } from "../entry-helpers";
import type { CanvasHoverInternals, HoverPreviewTarget } from "./types";
import { state } from "./types";
import { hoverState } from "./internals";

const SCROLL_NAV_HOLD_INTERVAL_MS = 90;
const SCROLL_NAV_HOLD_START_DELAY_MS = 180;

function stopScrollNavKeyHold(canvas: EpochCanvas): void {
	const s: any = state(canvas) as any;
	const startHandle = s.__scrollNavKeyHoldStartHandle as number | null | undefined;
	if (startHandle != null) {
		try {
			window.clearTimeout(startHandle);
		} catch {
			// ignore
		}
	}
	s.__scrollNavKeyHoldStartHandle = null;
	s.__scrollNavKeyHoldStartAt = null;

	const handle = s.__scrollNavKeyHoldHandle as number | null | undefined;
	if (handle != null) {
		try {
			window.clearInterval(handle);
		} catch {
			// ignore
		}
	}
	s.__scrollNavKeyHoldHandle = null;
	s.__scrollNavKeyHoldDirection = null;
}

function startScrollNavKeyHold(canvas: EpochCanvas, direction: number): void {
	const s: any = state(canvas) as any;
	const existing = s.__scrollNavKeyHoldHandle as number | null | undefined;
	s.__scrollNavKeyHoldDirection = direction;
	if (existing != null) return;
	try {
		s.__scrollNavKeyHoldHandle = window.setInterval(() => {
			const dir = Number((s as any).__scrollNavKeyHoldDirection);
			if (!Number.isFinite(dir) || dir === 0) return;
			s.advanceScrollNav(dir);
		}, SCROLL_NAV_HOLD_INTERVAL_MS);
	} catch {
		s.__scrollNavKeyHoldHandle = null;
	}
}

function scheduleScrollNavKeyHoldStart(canvas: EpochCanvas, direction: number): void {
	const s: any = state(canvas) as any;
	s.__scrollNavKeyHoldDirection = direction;
	const existingInterval = s.__scrollNavKeyHoldHandle as number | null | undefined;
	if (existingInterval != null) return;
	const existingStart = s.__scrollNavKeyHoldStartHandle as number | null | undefined;
	if (existingStart != null) return;
	try {
		s.__scrollNavKeyHoldStartAt = performance.now();
		s.__scrollNavKeyHoldStartHandle = window.setTimeout(() => {
			s.__scrollNavKeyHoldStartHandle = null;
			const dir = Number((s as any).__scrollNavKeyHoldDirection);
			if (!Number.isFinite(dir) || dir === 0) return;
			startScrollNavKeyHold(canvas, dir);
		}, SCROLL_NAV_HOLD_START_DELAY_MS);
	} catch {
		s.__scrollNavKeyHoldStartHandle = null;
		s.__scrollNavKeyHoldStartAt = null;
	}
}

export function hideHoverPreview(canvas: EpochCanvas): void {
	const state = hoverState(canvas);
	if (state.hoverPreviewKey == null) return;
	const hoverParent = getHoverParent(canvas);
	const maybePopover = (hoverParent as any)?.hoverPopover;
	if (maybePopover?.hide instanceof Function) {
		try {
			maybePopover.hide();
		} catch (error) {
			void error;
		}
	}
	state.hoverPreviewKey = null;
}

export function attemptHoverPreview(canvas: EpochCanvas, event: MouseEvent | null): void {
	const state = hoverState(canvas);
	if (!state.isPointerDeviceEvent()) return;
	if (state.isDragging) {
		state.hoverPreviewKey = null;
		return;
	}
	if (!event) {
		return;
	}
	if (state.previewLockedUntilAltRelease) {
		state.hoverPreviewKey = null;
		return;
	}

	state.modKeyActive = isModPressed(event);

	if (!state.modKeyActive) {
		state.previewLockedNotified = false;
	}

	try {
		const rect = state.canvas.getBoundingClientRect();
		const localX = event.clientX - rect.left;
		const localY = event.clientY - rect.top;
		const entry = (canvas as any)?.findSummaryEntryAtPoint?.(localX, localY) as DateEntry | null;
		const filePath = entry ? String((entry as any).file || "") : "";
		if (entry && filePath.startsWith("epoch://")) {
			state.hoverPreviewKey = null;
			return;
		}
	} catch {
		// ignore
	}

	state.previewLockedNotified = false;

	if (!state.modKeyActive) {
		state.hoverPreviewKey = null;
		return;
	}

	const sourceEvent = event ?? state.lastPointerEvent;
	if (!sourceEvent) return;

	const target = resolveHoverPreviewTarget(canvas);
	if (!target) {
		state.hoverPreviewKey = null;
		return;
	}

	const effectiveEvent = clonePointerEventForPreview(state, sourceEvent);
	emitHoverPreview(canvas, target, effectiveEvent);
}

function resolveHoverPreviewTarget(canvas: EpochCanvas): HoverPreviewTarget | null {
	const summaryTarget = resolvePreviewTargetForSummary(canvas);
	if (summaryTarget) return summaryTarget;
	return resolvePreviewTargetForDate(canvas);
}

function resolvePreviewTargetForSummary(canvas: EpochCanvas): HoverPreviewTarget | null {
	const entry = getHoveredSummaryEntry(canvas);
	if (!entry) return null;
	return resolvePreviewTargetForEntry(canvas, entry);
}

function resolvePreviewTargetForEntry(canvas: EpochCanvas, entry: DateEntry): HoverPreviewTarget | null {
	const state = hoverState(canvas);
	const file = state.plugin.app.vault.getAbstractFileByPath(entry.file);
	if (!(file instanceof TFile)) {
		return null;
	}
	const sourcePath = state.activeFilePath ?? entry.file ?? file.path;
	return {
		file,
		sourcePath: sourcePath || file.path,
		key: `file:${file.path}`
	};
}

function resolvePreviewTargetForDate(canvas: EpochCanvas): HoverPreviewTarget | null {
	const state = hoverState(canvas);
	const idx = state.hoverDateIndex;
	if (idx == null) return null;
	const date = state.getDateForIndex(idx, state.getToday());
	const dateFile = state.getFileForDate(date);
	if (dateFile instanceof TFile) {
		return {
			file: dateFile,
			sourcePath: dateFile.path,
			key: `file:${dateFile.path}`
		};
	}
	const entries = getEntriesForDateHelper(canvas, date);
	for (const entry of entries) {
		const target = resolvePreviewTargetForEntry(canvas, entry);
		if (target) return target;
	}
	return null;
}

function emitHoverPreview(canvas: EpochCanvas, target: HoverPreviewTarget, event: MouseEvent): void {
	const state = hoverState(canvas);
	if (state.hoverPreviewKey === target.key) return;
	const hoverParent = getHoverParent(canvas);
	if (!hoverParent) return;
	const file = target.file;
	const sourcePath = target.sourcePath || file.path;
	const metadataCache = state.plugin.app.metadataCache;
	const linktext = metadataCache?.fileToLinktext?.(file, sourcePath) ?? file.path;
	const maybePopover = (hoverParent as any)?.hoverPopover;
	if (maybePopover?.hide instanceof Function) {
		try {
			maybePopover.hide();
		} catch (error) {
			void error;
		}
	}
	state.hoverPreviewKey = target.key;
	const expectedKey = target.key;
	window.setTimeout(() => {
		const latest = hoverState(canvas);
		const stillHovering = latest.hoverSummary != null || latest.hoverDateIndex != null;
		const stillEligible = latest.modKeyActive === true && stillHovering && latest.hoverPreviewKey === expectedKey;
		if (!stillEligible) {
			if (latest.hoverPreviewKey === expectedKey) {
				latest.hoverPreviewKey = null;
			}
			return;
		}
		const current = resolveHoverPreviewTarget(canvas);
		if (!current || current.key !== expectedKey) {
			if (latest.hoverPreviewKey === expectedKey) {
				latest.hoverPreviewKey = null;
			}
			return;
		}
		latest.plugin.app.workspace.trigger("hover-link", {
			event,
			source: latest.hoverSourceId,
			hoverParent,
			targetEl: latest.canvas,
			linktext,
			sourcePath
		});
	}, HOVER_PREVIEW_RETRIGGER_DELAY_MS);
}

function clonePointerEventForPreview(state: CanvasHoverInternals, source: MouseEvent): MouseEvent {
	return new MouseEvent("mousemove", {
		clientX: source.clientX,
		clientY: source.clientY,
		screenX: source.screenX,
		screenY: source.screenY,
		ctrlKey: source.ctrlKey,
		metaKey: source.metaKey,
		altKey: source.altKey || state.modKeyActive,
		shiftKey: source.shiftKey,
		button: source.button,
		buttons: source.buttons,
		bubbles: false,
		cancelable: false,
		view: source.view ?? window
	});
}

function getHoverParent(canvas: EpochCanvas): HoverParent | null {
	const state = hoverState(canvas);
	if (state.hoverParent) return state.hoverParent;
	const workspace = state.plugin?.app?.workspace;
	const getMostRecentLeaf = workspace?.getMostRecentLeaf;
	if (typeof getMostRecentLeaf === "function") {
		return getMostRecentLeaf.call(workspace) ?? null;
	}
	return null;
}

function getHoveredSummaryEntry(canvas: EpochCanvas): DateEntry | null {
	const state = hoverState(canvas);
	const hover = state.hoverSummary;
	if (!hover) return null;
	for (const layout of state.layouts) {
		if (layout.index !== hover.dayIndex) continue;
		for (const summary of layout.summaryRects) {
			if (summary.itemIndex === hover.itemIndex) {
				return summary.entry;
			}
		}
	}
	return null;
}

export function onWindowKeyDown(canvas: EpochCanvas, event: KeyboardEvent): void {
	const hState = hoverState(canvas);
	if (!hState.isPointerDeviceEvent()) return;
	const epochsViewActive = canvas.isEpochsViewActive?.() === true;

	if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
		let direction: number | null = null;
		if (event.key === "ArrowUp") {
			direction = -1;
		} else if (event.key === "ArrowDown") {
			direction = 1;
		}
		if (direction !== null) {
			event.preventDefault();
			// Ignore OS key-repeat keydown events; use our own timer to keep motion smooth.
			if ((event as any).repeat === true) {
				scheduleScrollNavKeyHoldStart(canvas, direction);
				return;
			}
			const s = state(canvas);
			s.advanceScrollNav(direction);
			scheduleScrollNavKeyHoldStart(canvas, direction);
			s.previewLockedUntilAltRelease = true;
			s.hoverPreviewKey = null;
			hideHoverPreview(canvas);
			return;
		}
	}

	if (epochsViewActive) return;

	if (!isModKeyEvent(event)) return;
	if (hState.modKeyActive) return;
	hState.modKeyActive = true;
	tryTriggerHoverPreviewFromState(canvas);
}

export function onWindowKeyUp(canvas: EpochCanvas, event: KeyboardEvent): void {
	const hState = hoverState(canvas);
	if (!hState.isPointerDeviceEvent()) return;
	if (event.key === "ArrowUp" || event.key === "ArrowDown") {
		stopScrollNavKeyHold(canvas);
		return;
	}
	if (!isModKeyEvent(event)) return;
	hState.modKeyActive = false;
	hState.hoverPreviewKey = null;
	hState.previewLockedUntilAltRelease = false;
	stopScrollNavKeyHold(canvas);
	if (canvas.isEpochsViewActive?.() === true) return;
}

function tryTriggerHoverPreviewFromState(canvas: EpochCanvas): void {
	const hState = hoverState(canvas);
	if (!hState.modKeyActive) return;
	if (!hState.hoverSummary && hState.hoverDateIndex == null) return;
	const event = hState.lastPointerEvent;
	if (!event) return;
	attemptHoverPreview(canvas, event);
}

function isModPressed(event: MouseEvent): boolean {
	return event.altKey;
}

function isModKeyEvent(event: KeyboardEvent): boolean {
	if (event.key === "Alt") return true;
	const code = event.code;
	return code === "AltLeft" || code === "AltRight";
}
