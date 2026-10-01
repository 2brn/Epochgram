import { Platform } from "obsidian";
import type { DateEntry, FileIndexData, PinMode } from "../indexer/types";
import type { EpochIndex } from "../indexer/types";
import type { EpochCanvas } from "./epoch-canvas";
import type { DayLayout } from "./epoch-canvas-types";
import { DEFAULT_SETTINGS, type EpochSettings } from "../settings-model";
import { BASE_SPACING, DOUBLE_TAP_MAX_DELAY, LABEL_OFFSET_X, LONG_PRESS_MS, TIMELINE_X } from "./epoch-canvas-constants";
import { openEntry } from "./epoch-canvas-actions";
import { beginAnchorEntryDrag, commitAnchorEntryDrag, updateAnchorEntryDrag } from "./epoch-canvas-events/anchor-dnd";
import { focusDateWithZoom } from "./epoch-canvas-focus";
import { getToday } from "./epoch-canvas-helpers";
import { getEpochMarkColorSet } from "./mark-colors";
import { getEntryMarkColor, getInheritedMarkColor } from "./summary-rendering/entry-mark-colors";
import { entryFileName, formatEntrySummary, parseFontSize, withFontStyle, withFontWeight } from "./epoch-canvas-utils";

type IndexerLike = {
	getIndexedPaths?: () => string[];
	getFileIndexData?: (path: string) => FileIndexData | null;
	index?: EpochIndex;
};

type PendingPinOpen = {
	timer: number;
	key: string;
	removeOutsideListener?: () => void;
};

type PinOverlayState = {
	root: HTMLElement;
	plugin?: {
		indexer?: IndexerLike;
		settings?: Pick<EpochSettings, "filenameWordsCount" | "summaryWordsCount">;
		__epochInheritedMarkIndexByPath?: Map<string, number> | null;
	};
	draw?: () => void;
	pinOverlayEl: HTMLElement | null;
	lastPinOverlaySignature: string | null;
	pendingPinOpen?: PendingPinOpen | null;
	pinOpenInFlight?: boolean;
	touchUnhoveredPin?: { file: string; date: string } | null;
	layouts: DayLayout[];
	scale: number;
	offsetY: number;
	activeFilePath: string | null;
	activeFileTimelineEntry?: DateEntry | null;
	semanticRelatedPaths: Set<string> | null;
	ctx: CanvasRenderingContext2D;
	keepHoverAfterMenu?: boolean;
	showSummaryMenu?(entry: DateEntry, clientX: number, clientY: number): unknown;
	clearHover(force?: boolean): void;
	canvas: HTMLCanvasElement;
};

type DragGhostLike = {
	img: HTMLCanvasElement;
	w: number;
	h: number;
	offsetX: number;
	offsetY: number;
	x: number;
	y: number;
};

type MenuLike = {
	onHide?: (cb: () => void) => void;
	hide?: () => void;
	close?: () => void;
};

type PinActivationEvent = Event & Pick<MouseEvent, "ctrlKey" | "metaKey">;

type PinRenderItem = {
	key: string;
	entry: DateEntry;
	label: string;
	dayIndex: number;
	date: Date;
	fill: string;
	text: string;
	left: number;
	width: number;
	top: number;
	opacity: number;
	font: string;
	mode: Exclude<PinMode, "today">;
	targetY: number;
	dock: "none" | "top" | "bottom";
};

export type PinBadgeRect = {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
};

const PIN_HEIGHT = 16;
const PIN_GAP = 4;
const PIN_TOP_PAD = 4;
const PIN_BOTTOM_PAD = 4;
const PIN_DOCK_OPACITY = 0.5;
const PIN_VISIBLE_OPACITY = 1;
const PIN_FONT_DELTA_PX = -4;
const PIN_DOUBLE_TAP_MS = DOUBLE_TAP_MAX_DELAY;
const PIN_NEAR_OVERLAP_PAD = 4;

function fontMinusPx(font: string, deltaPx: number): string {
	const parsed = parseFontSize(font);
	const nextSize = Math.max(6, parsed.size + deltaPx);
	return `${parsed.prefix}${nextSize.toFixed(2)}px${parsed.suffix}`;
}

function state(canvas: EpochCanvas): PinOverlayState {
	return canvas as unknown as PinOverlayState;
}

function parseDateKey(value: string): Date | null {
	const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	const date = new Date(year, month, day);
	date.setHours(0, 0, 0, 0);
	return date;
}

function dayIndexForDate(dateKey: string, today: Date): number | null {
	const date = parseDateKey(dateKey);
	if (!date) return null;
	const todayMidnight = new Date(today.getTime());
	todayMidnight.setHours(0, 0, 0, 0);
	const diffMs = todayMidnight.getTime() - date.getTime();
	return Math.round(diffMs / 86400000);
}

function getAnchorEntry(data: FileIndexData | null | undefined): DateEntry | null {
	return data?.namedDate ?? data?.dateProp ?? data?.cdate ?? null;
}

function getMode(data: FileIndexData | null | undefined): Exclude<PinMode, "today"> | null {
	const mode = typeof data?.pinnedFile === "string" ? data.pinnedFile : null;
	return mode === "date" || mode === "dock" ? mode : null;
}

function getRefreshedSelectedTimelineEntry(
	indexer: IndexerLike | undefined,
	path: string,
	selectedEntry: DateEntry
): DateEntry | null {
	const selectedDate = String(selectedEntry.date || "");
	if (!selectedDate) return null;
	const selectedSource = selectedEntry.source;
	const selectedStart = Number(selectedEntry.blockStart);
	const selectedEnd = Number(selectedEntry.blockEnd);
	let closest: DateEntry | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const entries of Object.values(indexer?.index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || entry.file !== path || entry.date !== selectedDate || entry.source !== selectedSource) continue;
			const entryStart = Number(entry.blockStart);
			const entryEnd = Number(entry.blockEnd);
			if (entryStart === selectedStart && entryEnd === selectedEnd) return entry;
			const distance = Math.abs(entryStart - selectedStart) + Math.abs(entryEnd - selectedEnd);
			if (distance < closestDistance) {
				closest = entry;
				closestDistance = distance;
			}
		}
	}
	return closest;
}

function getActiveFileDockEntry(
	indexer: IndexerLike | undefined,
	path: string,
	selectedEntry: DateEntry | null | undefined
): DateEntry | null {
	if (selectedEntry?.file === path && selectedEntry.date) {
		// Keep the clicked record/date, but use its current indexed data so edits
		// refresh the dock label and review styling without another click.
		return getRefreshedSelectedTimelineEntry(indexer, path, selectedEntry) ?? selectedEntry;
	}
	const anchor = getAnchorEntry(indexer?.getFileIndexData?.(path) ?? null);
	if (anchor?.date) return anchor;

	let best: DateEntry | null = null;
	let bestPriority = Number.POSITIVE_INFINITY;
	let bestDate = Number.NEGATIVE_INFINITY;
	for (const entries of Object.values(indexer?.index ?? {})) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || entry.file !== path || !entry.date) continue;
			const priority = entry.source === "namedate"
				? 0
				: entry.source === "dateprop"
					? 1
					: entry.source === "cdate"
						? 2
						: entry.source === "content"
							? 3
							: 4;
			const date = parseDateKey(entry.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
			if (priority < bestPriority || (priority === bestPriority && date > bestDate)) {
				best = entry;
				bestPriority = priority;
				bestDate = date;
			}
		}
	}
	return best;
}

function getBackgroundColor(root: HTMLElement): string {
	const css = root.ownerDocument?.defaultView?.getComputedStyle(root);
	return css?.getPropertyValue("--background-primary").trim()
		|| css?.getPropertyValue("--background-secondary").trim()
		|| css?.backgroundColor
		|| "var(--background-primary)";
}

function getDefaultTextColor(root: HTMLElement): string {
	const css = root.ownerDocument?.defaultView?.getComputedStyle(root);
	return css?.getPropertyValue("--text-muted").trim()
		|| css?.getPropertyValue("--text-normal").trim()
		|| "var(--text-muted)";
}

function getRelatedColor(root: HTMLElement): string {
	const css = root.ownerDocument?.defaultView?.getComputedStyle(root);
	return css?.getPropertyValue("--text-accent").trim() || getDefaultTextColor(root);
}

function getFillColor(s: PinOverlayState, entry: DateEntry): string {
	const root = s.root;
	const fallback = getDefaultTextColor(root);
	const highlight = getRelatedColor(root);
	const markColors = getEpochMarkColorSet(root);
	const explicit = getEntryMarkColor(entry, markColors, highlight);
	if (explicit) return explicit;
	const inherited = getInheritedMarkColor(entry, markColors, highlight, s.plugin?.__epochInheritedMarkIndexByPath ?? null);
	if (inherited) return inherited;
	if (entry.file === s.activeFilePath) return highlight;
	if (s.semanticRelatedPaths?.has(entry.file)) return highlight;
	return fallback;
}

function getLabel(
	entry: DateEntry,
	settings: Pick<EpochSettings, "filenameWordsCount" | "summaryWordsCount"> | undefined
): string {
	const label = formatEntrySummary(entry, {
		fallbackToFileName: true,
		includeIcons: false,
		filenameWordsCount: settings?.filenameWordsCount ?? DEFAULT_SETTINGS.filenameWordsCount,
		summaryWordsCount: settings?.summaryWordsCount ?? DEFAULT_SETTINGS.summaryWordsCount
	}).trim();
	return label || entryFileName(entry).replace(/\.md$/i, "").trim();
}

function positionVisible(items: PinRenderItem[]): void {
	items.sort((a, b) => a.targetY - b.targetY);
	let lastBottom = Number.NEGATIVE_INFINITY;
	for (const item of items) {
		const desiredTop = item.targetY - PIN_HEIGHT / 2;
		item.top = Math.max(desiredTop, lastBottom + PIN_GAP);
		lastBottom = item.top + PIN_HEIGHT;
	}
}

function positionDocked(items: PinRenderItem[], dock: "top" | "bottom", height: number): void {
	if (dock === "top") {
		items.sort((a, b) => a.targetY - b.targetY);
		let top = PIN_TOP_PAD;
		for (const item of items) {
			item.top = top;
			top += PIN_HEIGHT + PIN_GAP;
		}
		return;
	}
	items.sort((a, b) => b.targetY - a.targetY);
	let bottomTop = height - PIN_BOTTOM_PAD - PIN_HEIGHT;
	for (const item of items) {
		item.top = bottomTop;
		bottomTop -= PIN_HEIGHT + PIN_GAP;
	}
}

	function harmonizeDockedAndVisible(topDocked: PinRenderItem[], visible: PinRenderItem[], bottomDocked: PinRenderItem[]): void {
		if (visible.length === 0) return;
		const nearGap = PIN_GAP + PIN_NEAR_OVERLAP_PAD;

		if (topDocked.length > 0) {
			topDocked.sort((a, b) => a.top - b.top);
			const visibleAsc = [...visible].sort((a, b) => a.top - b.top);
			let occupiedBottom = topDocked[topDocked.length - 1].top + PIN_HEIGHT;
			for (const item of visibleAsc) {
				if (item.top < occupiedBottom + nearGap) {
					item.top = occupiedBottom + PIN_GAP;
				}
				occupiedBottom = item.top + PIN_HEIGHT;
			}
		}

		if (bottomDocked.length > 0) {
			bottomDocked.sort((a, b) => a.top - b.top);
			const visibleDesc = [...visible].sort((a, b) => b.top - a.top);
			let occupiedTop = bottomDocked[0].top;
			for (const item of visibleDesc) {
				if (item.top + PIN_HEIGHT > occupiedTop - nearGap) {
					item.top = occupiedTop - PIN_GAP - PIN_HEIGHT;
				}
				occupiedTop = item.top;
			}
		}
	}

function computeItems(canvas: EpochCanvas): PinRenderItem[] {
	const s = state(canvas);
	const indexer = s.plugin?.indexer;
	const paths = typeof indexer?.getIndexedPaths === "function" ? indexer.getIndexedPaths() : [];
	const activePath = String(s.activeFilePath ?? "");
	const today = getToday();
	const width = TIMELINE_X - LABEL_OFFSET_X;
	const background = getBackgroundColor(s.root);
	const css = s.root.ownerDocument?.defaultView?.getComputedStyle(s.root);
	const fontMain = fontMinusPx(css?.getPropertyValue("--epoch-font-main").trim() || "12px var(--font-text)", PIN_FONT_DELTA_PX);
	const fontActive = withFontWeight(fontMain, "700");
	const visible: PinRenderItem[] = [];
	const topDocked: PinRenderItem[] = [];
	const bottomDocked: PinRenderItem[] = [];
	let hasActiveDockItem = false;

	const addItem = (path: string, entry: DateEntry, mode: Exclude<PinMode, "today">, virtual: boolean = false): void => {
		if (!entry?.date) return;
		const dayIndex = dayIndexForDate(entry.date, today);
		if (dayIndex == null) return;
		const targetY = dayIndex * BASE_SPACING * s.scale + s.offsetY;
		const inViewport = targetY >= 0 && targetY <= s.root.clientHeight;
		if (mode === "date" && !inViewport) return;
		let font = path === activePath ? fontActive : fontMain;
		// Mirror timeline records: draft entries use italic text.
		if (entry.reviewState === "draft") font = withFontStyle(font, "italic");
		const item: PinRenderItem = {
			key: `${path}:${virtual ? "active-dock" : mode}:${entry.date}`,
			entry,
			label: getLabel(entry, s.plugin?.settings),
			dayIndex,
			date: parseDateKey(entry.date) ?? today,
			fill: getFillColor(s, entry),
			text: background,
			left: 0,
			width,
			top: 0,
			opacity: inViewport ? PIN_VISIBLE_OPACITY : PIN_DOCK_OPACITY,
			font,
			mode,
			targetY,
			dock: "none"
		};
		if (inViewport) {
			visible.push(item);
			return;
		}
		if (targetY < 0) {
			item.dock = "top";
			topDocked.push(item);
			return;
		}
		if (targetY > s.root.clientHeight) {
			item.dock = "bottom";
			bottomDocked.push(item);
		}
	};

	for (const path of paths) {
		const data = indexer?.getFileIndexData?.(path) ?? null;
		const isActive = !!activePath && path === activePath;
		const mode = isActive ? "dock" : getMode(data);
		if (!mode) continue;
		const entry = isActive ? getActiveFileDockEntry(indexer, path, s.activeFileTimelineEntry) : getAnchorEntry(data);
		if (!entry?.date) continue;
		addItem(path, entry, mode, isActive);
		if (isActive) hasActiveDockItem = true;
	}

	// The currently opened file gets a transient dock pin, without changing its YAML pin state.
	if (activePath && !hasActiveDockItem) {
		const entry = getActiveFileDockEntry(indexer, activePath, s.activeFileTimelineEntry);
		if (entry) addItem(activePath, entry, "dock", true);
	}

	positionVisible(visible);
	positionDocked(topDocked, "top", s.root.clientHeight);
	positionDocked(bottomDocked, "bottom", s.root.clientHeight);
	harmonizeDockedAndVisible(topDocked, visible, bottomDocked);
	return [...visible, ...topDocked, ...bottomDocked];
}

export function getPinBadgeRects(canvas: EpochCanvas): PinBadgeRect[] {
	const items = computeItems(canvas);
	if (!Array.isArray(items) || items.length === 0) return [];
	return items.map((item) => ({
		x1: item.left,
		y1: item.top,
		x2: item.left + item.width,
		y2: item.top + PIN_HEIGHT
	}));
}

function buildSignature(items: PinRenderItem[]): string {
	return items
		.map((item) => [item.key, item.top, item.opacity, item.label, item.fill, item.text, item.dock, item.font].join("|"))
		.join(";");
}

function createBadgeGhost(canvas: EpochCanvas, button: HTMLButtonElement, item: PinRenderItem, clientX: number, clientY: number): DragGhostLike | null {
	try {
		const rect = button.getBoundingClientRect();
		const w = Math.max(1, Math.round(rect.width));
		const h = Math.max(1, Math.round(rect.height));
		if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
		const s = state(canvas);
		const doc = s.root?.ownerDocument ?? (typeof window !== "undefined" ? window.document : null);
		if (!doc) return null;
		const winWithCreateEl = doc.win as Window & { createEl: (tag: "canvas") => HTMLCanvasElement };
		const off: HTMLCanvasElement = winWithCreateEl.createEl("canvas");
		off.width = w;
		off.height = h;
		const g = off.getContext("2d");
		if (!g) return null;

		g.clearRect(0, 0, w, h);
		g.fillStyle = item.fill;
		const tip = Math.max(6, Math.min(14, Math.round(w * 0.06)));
		const r = Math.max(1.5, Math.min(3, h * 0.2));
		g.beginPath();
		g.moveTo(r, 0);
		g.lineTo(w - tip, 0);
		g.lineTo(w, h / 2);
		g.lineTo(w - tip, h);
		g.lineTo(r, h);
		g.quadraticCurveTo(0, h, 0, h - r);
		g.lineTo(0, r);
		g.quadraticCurveTo(0, 0, r, 0);
		g.closePath();
		g.fill();

		g.fillStyle = item.text;
		g.font = item.font;
		g.textBaseline = "middle";
		g.textAlign = "left";
		const scaleY = h / Math.max(1, PIN_HEIGHT);
		const labelScale = scaleY > 1 ? 1.08 : 1;
		g.save();
		g.beginPath();
		g.rect(4, 0, Math.max(0, w - tip - 4), h);
		g.clip();
		if (labelScale !== 1) {
			g.translate(4, h / 2);
			g.scale(1.03, labelScale);
			g.fillText(item.label, 0, 0);
		} else {
			g.fillText(item.label, 4, h / 2);
		}
		g.restore();

		const offsetX = Math.max(0, Math.min(w, clientX - rect.left));
		const offsetY = Math.max(0, Math.min(h, clientY - rect.top));
		const canvasRect = s.canvas.getBoundingClientRect();
		const localX = clientX - canvasRect.left;
		const localY = clientY - canvasRect.top;
		return {
			img: off,
			w,
			h,
			offsetX,
			offsetY,
			x: localX - offsetX,
			y: localY - offsetY
		};
	} catch {
		return null;
	}
}

function clearPendingPinOpen(s: PinOverlayState): void {
	const pending = s.pendingPinOpen;
	if (!pending) return;
	window.clearTimeout(pending.timer);
	try {
		pending.removeOutsideListener?.();
	} catch {
		// ignore
	}
	s.pendingPinOpen = null;
}

function isPinBadgeTarget(target: EventTarget | null): boolean {
	try {
		const element = target as {
			closest?: (selector: string) => Element | null;
			parentElement?: { closest?: (selector: string) => Element | null } | null;
		} | null;
		return !!(element?.closest?.(".epoch-pin-badge") || element?.parentElement?.closest?.(".epoch-pin-badge"));
	} catch {
		return false;
	}
}

function addPendingPinOpenOutsideListener(s: PinOverlayState, pending: PendingPinOpen, button: HTMLButtonElement): void {
	const doc = button.ownerDocument ?? s.root.ownerDocument;
	if (!doc?.addEventListener) return;
	const cancelOutsidePin = (ev: Event) => {
		if (s.pendingPinOpen !== pending || isPinBadgeTarget(ev.target)) return;
		clearPendingPinOpen(s);
	};
	const remove = () => {
		doc.removeEventListener("pointerdown", cancelOutsidePin, true);
		doc.removeEventListener("touchstart", cancelOutsidePin, true);
	};
	pending.removeOutsideListener = remove;
	doc.addEventListener("pointerdown", cancelOutsidePin, true);
	doc.addEventListener("touchstart", cancelOutsidePin, true);
}

function armPendingPinOpen(
	canvas: EpochCanvas,
	item: PinRenderItem,
	button: HTMLButtonElement,
	ev: PinActivationEvent,
	pending: PendingPinOpen
): void {
	const s = state(canvas);
	pending.timer = window.setTimeout(() => {
		if (s.pendingPinOpen !== pending) return;
		clearPendingPinOpen(s);
		void handleOpenOnly(canvas, item, ev, button);
	}, PIN_DOUBLE_TAP_MS);
}

function schedulePinOpen(canvas: EpochCanvas, item: PinRenderItem, button: HTMLButtonElement, ev: PinActivationEvent): void {
	const s = state(canvas);
	clearPendingPinOpen(s);
	const pending: PendingPinOpen = { timer: 0, key: item.key };
	armPendingPinOpen(canvas, item, button, ev, pending);
	s.pendingPinOpen = pending;
	addPendingPinOpenOutsideListener(s, pending, button);
}

function deferPendingPinOpenForTouch(
	canvas: EpochCanvas,
	item: PinRenderItem,
	button: HTMLButtonElement,
	ev: TouchEvent
): boolean {
	const s = state(canvas);
	const pending = s.pendingPinOpen;
	if (!pending || pending.key !== item.key) return false;
	// A second touch can begin just before the single-tap timer fires. Give its
	// synthetic click the full double-tap window to arrive before opening.
	window.clearTimeout(pending.timer);
	armPendingPinOpen(canvas, item, button, ev, pending);
	return true;
}

function hasSamePinTarget(
	value: { file: string; date: string } | null | undefined,
	item: PinRenderItem
): boolean {
	return value?.file === item.entry.file && value?.date === item.entry.date;
}

function clearTouchUnhoverForPin(s: PinOverlayState, item: PinRenderItem, button: HTMLButtonElement): void {
	if (!hasSamePinTarget(s.touchUnhoveredPin, item)) return;
	s.touchUnhoveredPin = null;
	button.classList.remove("is-touch-unhovered");
}

function markPinBadgeTouchUnhovered(s: PinOverlayState, item: PinRenderItem, button?: HTMLButtonElement): void {
	if (!Platform.isMobile) return;
	s.touchUnhoveredPin = { file: item.entry.file, date: item.entry.date };
	try {
		button?.classList.add("is-touch-unhovered");
	} catch {
		// ignore
	}
}

function clearPinBadgeInteraction(s: PinOverlayState, item: PinRenderItem, button: HTMLButtonElement | null | undefined): void {
	markPinBadgeTouchUnhovered(s, item, button ?? undefined);
	if (!button) return;
	try {
		button.classList.remove("is-menu-hovered");
		button.blur();
	} catch {
		// ignore
	}
}

async function handleOpenOnly(
	canvas: EpochCanvas,
	item: PinRenderItem,
	ev: PinActivationEvent,
	button?: HTMLButtonElement
): Promise<void> {
	ev.preventDefault();
	ev.stopPropagation();
	const s = state(canvas);
	// Mark this before opening so a badge recreated by the active-file update
	// cannot inherit a sticky touch hover.
	markPinBadgeTouchUnhovered(s, item, button);
	// Badge buttons are recreated on redraw. Keep the guard on the canvas so
	// delayed clicks from detached buttons cannot overlap workspace leaf opens.
	if (s.pinOpenInFlight) {
		s.keepHoverAfterMenu = false;
		clearPinBadgeInteraction(s, item, button);
		s.clearHover(true);
		return;
	}
	s.pinOpenInFlight = true;
	try {
		await openEntry(canvas, item.entry, ev as MouseEvent, true);
	} finally {
		s.pinOpenInFlight = false;
		s.keepHoverAfterMenu = false;
		clearPinBadgeInteraction(s, item, button);
		s.clearHover(true);
	}
}

function handleFocusOnly(canvas: EpochCanvas, item: PinRenderItem, ev: PinActivationEvent, button?: HTMLButtonElement): void {
	ev.preventDefault();
	ev.stopPropagation();
	focusDateWithZoom(canvas, item.date, true, false);
	const s = state(canvas);
	s.keepHoverAfterMenu = false;
	clearPinBadgeInteraction(s, item, button);
	s.clearHover(true);
}

function showPinSummaryMenu(canvas: EpochCanvas, button: HTMLButtonElement, item: PinRenderItem, clientX: number, clientY: number): MenuLike | null {
	const s = state(canvas);
	if (typeof s.showSummaryMenu !== "function") return null;
	s.keepHoverAfterMenu = true;
	button.classList.add("is-menu-hovered");
	const doc = s.root?.ownerDocument ?? (typeof window !== "undefined" ? window.document : null);
	let removeOutsideListener: (() => void) | null = null;
	let clearMenuHoverTimer: number | null = null;
	const clearMenuHoverNow = () => {
		if (clearMenuHoverTimer != null) {
			window.clearTimeout(clearMenuHoverTimer);
			clearMenuHoverTimer = null;
		}
		button.classList.remove("is-menu-hovered");
		if (removeOutsideListener) {
			try {
				removeOutsideListener();
			} catch {
				// ignore
			}
			removeOutsideListener = null;
		}
	};
	const clearMenuHover = (delayMs: number = 0) => {
		if (delayMs <= 0) {
			clearMenuHoverNow();
			return;
		}
		if (clearMenuHoverTimer != null) {
			window.clearTimeout(clearMenuHoverTimer);
		}
		clearMenuHoverTimer = window.setTimeout(() => {
			clearMenuHoverTimer = null;
			clearMenuHoverNow();
		}, delayMs);
	};
	const menu = s.showSummaryMenu(item.entry, clientX, clientY) as MenuLike | null | undefined;
	try {
		menu?.onHide?.(() => {
			clearMenuHover(90);
		});
	} catch {
		// ignore
	}
	try {
		if (doc) {
			const onOutside = (ev: Event) => {
				const target = ev.target instanceof Element ? ev.target : null;
				if (target && (target.closest(".menu") || target.closest(".epoch-pin-badge"))) return;
				clearMenuHover(90);
			};
			removeOutsideListener = () => {
				doc.removeEventListener("pointerdown", onOutside, true);
				doc.removeEventListener("touchstart", onOutside, true);
			};
			doc.addEventListener("pointerdown", onOutside, true);
			doc.addEventListener("touchstart", onOutside, true);
		}
	} catch {
		// ignore
	}
	return menu ?? null;
}

export function updatePinOverlay(canvas: EpochCanvas): void {
	const s = state(canvas);
	const overlay = s.pinOverlayEl;
	if (!overlay) return;
	const items = computeItems(canvas);
	const signature = buildSignature(items);
	if (signature === s.lastPinOverlaySignature) return;
	s.lastPinOverlaySignature = signature;
	if (items.length === 0) {
		overlay.replaceChildren();
		return;
	}
	overlay.replaceChildren();
	for (const item of items) {
		const button = overlay.createEl("button", { cls: "epoch-pin-badge" });
		button.type = "button";
		button.draggable = false;
		button.removeAttribute("title");
		button.setAttribute("aria-hidden", "true");
		button.style.left = `${item.left}px`;
		button.style.top = `${item.top}px`;
		button.style.width = `${item.width}px`;
		button.style.height = `${PIN_HEIGHT}px`;
		button.style.opacity = `${item.opacity}`;
		button.style.setProperty("--epoch-pin-fill", item.fill);
		button.style.setProperty("--epoch-pin-text", item.text);
		if (item.dock !== "none") button.classList.add(`is-${item.dock}`);
		if (hasSamePinTarget(s.touchUnhoveredPin, item)) button.classList.add("is-touch-unhovered");
		const label = button.createSpan({ cls: "epoch-pin-badge-label" });
		label.textContent = item.label;
		label.style.font = item.font;
		s.ctx.save();
		s.ctx.font = item.font;
		const textWidth = s.ctx.measureText(item.label).width;
		s.ctx.restore();
		const textMaxWidth = Math.max(0, item.width - 17);
		const shouldJustify = textWidth > 0 && textWidth <= textMaxWidth;
		label.classList.toggle("is-justify", shouldJustify);
		label.classList.toggle("is-left", !shouldJustify);
		let dragArmed = false;
		let dragStarted = false;
		let dragStartX = 0;
		let dragStartY = 0;
		let skipClick = false;
		let activePointerId: number | null = null;
		const clearPointerDrag = () => {
			dragArmed = false;
			try {
				if (activePointerId != null && button.hasPointerCapture(activePointerId)) {
					button.releasePointerCapture(activePointerId);
				}
			} catch {
				// ignore
			}
			activePointerId = null;
			button.classList.remove("is-drag-source");
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerCancel);
		};
		const onPointerMove = (ev: PointerEvent) => {
			if (!dragArmed) return;
			const dx = ev.clientX - dragStartX;
			const dy = ev.clientY - dragStartY;
			if (!dragStarted && (Math.abs(dx) >= 4 || Math.abs(dy) >= 4)) {
				beginAnchorEntryDrag(canvas, item.entry, "mouse", dragStartX, dragStartY, item.entry);
				try {
					const ghost = createBadgeGhost(canvas, button, item, dragStartX, dragStartY);
					if (ghost) {
						const dragState = s as PinOverlayState & { entryDragGhost?: DragGhostLike | null; draw?: () => void };
						dragState.entryDragGhost = ghost;
						button.classList.add("is-drag-source");
						dragState.draw?.();
					}
				} catch {
					// ignore
				}
				dragStarted = true;
			}
			if (dragStarted) {
				updateAnchorEntryDrag(canvas, ev.clientX, ev.clientY);
				ev.preventDefault();
			}
		};
		const onPointerUp = (ev: PointerEvent) => {
			if (!dragArmed) return;
			const wasDragging = dragStarted;
			clearPointerDrag();
			dragStarted = false;
			if (!wasDragging) return;
			skipClick = true;
			void commitAnchorEntryDrag(canvas);
			ev.preventDefault();
			ev.stopPropagation();
		};
		const onPointerCancel = () => {
			if (!dragArmed) return;
			clearPointerDrag();
			dragStarted = false;
		};
		button.addEventListener("pointerdown", (ev) => {
			clearTouchUnhoverForPin(s, item, button);
			if (ev.pointerType && ev.pointerType !== "mouse") return;
			if (ev.button !== 0) return;
			if (item.dock !== "none") return;
			ev.preventDefault();
			dragArmed = true;
			dragStarted = false;
			dragStartX = ev.clientX;
			dragStartY = ev.clientY;
			activePointerId = ev.pointerId;
			try {
				button.setPointerCapture(ev.pointerId);
			} catch {
				// ignore
			}
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
			window.addEventListener("pointercancel", onPointerCancel);
		});
		let longPressTimer: number | null = null;
		let longPressFired = false;
		let touchTapInProgress = false;
		let touchStartX = 0;
		let touchStartY = 0;
		let touchDragStarted = false;
		let touchDragMenu: MenuLike | null = null;
		const clearLongPress = () => {
			if (longPressTimer != null) {
				window.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
		};
		button.addEventListener("touchstart", (ev) => {
			if (!ev.touches || ev.touches.length !== 1) {
				touchTapInProgress = false;
				clearLongPress();
				clearPendingPinOpen(s);
				return;
			}
			touchTapInProgress = true;
			clearTouchUnhoverForPin(s, item, button);
			const pending = s.pendingPinOpen;
			if (pending?.key === item.key) {
				deferPendingPinOpenForTouch(canvas, item, button, ev);
			} else if (pending) {
				clearPendingPinOpen(s);
			}
			clearLongPress();
			longPressFired = false;
			touchDragStarted = false;
			touchDragMenu = null;
			const t = ev.touches[0];
			touchStartX = t.clientX;
			touchStartY = t.clientY;
			longPressTimer = window.setTimeout(() => {
				longPressTimer = null;
				longPressFired = true;
				clearPendingPinOpen(s);
				touchDragMenu = showPinSummaryMenu(canvas, button, item, t.clientX, t.clientY);
			}, LONG_PRESS_MS);
		}, { passive: true });
		button.addEventListener("touchmove", (ev) => {
			if (!ev.touches || ev.touches.length !== 1) {
				clearLongPress();
				clearPendingPinOpen(s);
				return;
			}
			const t = ev.touches[0];
			if (!longPressFired) {
				const dx0 = t.clientX - touchStartX;
				const dy0 = t.clientY - touchStartY;
				if (Math.hypot(dx0, dy0) > 12) {
					clearLongPress();
					clearPendingPinOpen(s);
				}
				return;
			}
			if (!touchDragStarted) {
				const dx = t.clientX - touchStartX;
				const dy = t.clientY - touchStartY;
				if (Math.hypot(dx, dy) > 12) {
					try {
						touchDragMenu?.hide?.();
						touchDragMenu?.close?.();
					} catch {
						// ignore
					}
					touchDragMenu = null;
					beginAnchorEntryDrag(canvas, item.entry, "touch", t.clientX, t.clientY, item.entry);
					try {
						const ghost = createBadgeGhost(canvas, button, item, t.clientX, t.clientY);
						if (ghost) {
							const dragState = s as PinOverlayState & { entryDragGhost?: DragGhostLike | null; draw?: () => void };
							dragState.entryDragGhost = ghost;
							button.classList.add("is-drag-source");
							dragState.draw?.();
						}
					} catch {
						// ignore
					}
					touchDragStarted = true;
				}
			}
			if (touchDragStarted) {
				updateAnchorEntryDrag(canvas, t.clientX, t.clientY);
				ev.preventDefault();
				ev.stopPropagation();
			}
		}, { passive: false });
		button.addEventListener("touchend", (ev) => {
			touchTapInProgress = false;
			const wasTouchDragging = touchDragStarted;
			if (longPressFired) {
				ev.preventDefault();
				ev.stopPropagation();
			}
			if (wasTouchDragging) {
				skipClick = true;
				void commitAnchorEntryDrag(canvas);
				button.classList.remove("is-drag-source");
				ev.preventDefault();
				ev.stopPropagation();
			}
			touchDragStarted = false;
			touchDragMenu = null;
			clearLongPress();
		});
		button.addEventListener("touchcancel", (ev) => {
			if (touchTapInProgress) clearPendingPinOpen(s);
			touchTapInProgress = false;
			if (longPressFired) {
				ev.preventDefault();
				ev.stopPropagation();
			}
			touchDragStarted = false;
			touchDragMenu = null;
			button.classList.remove("is-drag-source");
			clearLongPress();
		});
		button.addEventListener("contextmenu", (ev) => {
			clearPendingPinOpen(s);
			ev.preventDefault();
			ev.stopPropagation();
			showPinSummaryMenu(canvas, button, item, ev.clientX, ev.clientY);
		});
		button.addEventListener("click", (ev) => {
			if (skipClick) {
				skipClick = false;
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
			if (longPressFired) {
				longPressFired = false;
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
			const pending = s.pendingPinOpen;
			if (pending?.key === item.key) {
				clearPendingPinOpen(s);
				handleFocusOnly(canvas, item, ev, button);
				return;
			}
			schedulePinOpen(canvas, item, button, ev);
		});
		button.addEventListener("dblclick", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
		});
		button.addEventListener("auxclick", (ev) => {
			if (ev.button !== 1) return;
			clearPendingPinOpen(s);
			void handleOpenOnly(canvas, item, ev, button);
		});
	}
}