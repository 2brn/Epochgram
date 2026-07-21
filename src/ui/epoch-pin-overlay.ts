import { Platform } from "obsidian";
import type { DateEntry, FileIndexData, PinMode } from "../indexer/types";
import type { EpochIndex } from "../indexer/types";
import type { EpochCanvas } from "./epoch-canvas";
import type { DayLayout } from "./epoch-canvas-types";
import { BASE_SPACING, LABEL_OFFSET_X, LONG_PRESS_MS, TIMELINE_X } from "./epoch-canvas-constants";
import { openEntry } from "./epoch-canvas-actions";
import { focusDateWithZoom, snapToDate } from "./epoch-canvas-focus";
import { getToday } from "./epoch-canvas-helpers";
import { getEpochMarkColorSet } from "./mark-colors";
import { getEntryMarkColor, getInheritedMarkColor } from "./summary-rendering/entry-mark-colors";
import { parseFontSize } from "./epoch-canvas-utils";

type IndexerLike = {
	getIndexedPaths?: () => string[];
	getFileIndexData?: (path: string) => FileIndexData | null;
	index?: EpochIndex;
};

type PinOverlayState = {
	root: HTMLElement;
	plugin?: {
		indexer?: IndexerLike;
		__epochInheritedMarkIndexByPath?: Map<string, number> | null;
	};
	pinOverlayEl: HTMLElement | null;
	lastPinOverlaySignature: string | null;
	layouts: DayLayout[];
	scale: number;
	offsetY: number;
	activeFilePath: string | null;
	semanticRelatedPaths: Set<string> | null;
	ctx: CanvasRenderingContext2D;
	keepHoverAfterMenu?: boolean;
	showSummaryMenu?(entry: DateEntry, clientX: number, clientY: number): unknown;
	clearHover(force?: boolean): void;
	canvas: HTMLCanvasElement;
};

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

const PIN_HEIGHT = 16;
const PIN_GAP = 4;
const PIN_TOP_PAD = 4;
const PIN_BOTTOM_PAD = 4;
const PIN_DOCK_OPACITY = 0.5;
const PIN_VISIBLE_OPACITY = 1;
const PIN_FONT_DELTA_PX = -4;

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

function getBackgroundColor(root: HTMLElement): string {
	const css = root.ownerDocument?.defaultView?.getComputedStyle(root);
	return css?.getPropertyValue("--background-primary").trim()
		|| css?.getPropertyValue("--background-secondary").trim()
		|| css?.backgroundColor
		|| "var(--background-primary)";
}

function getDefaultTextColor(root: HTMLElement): string {
	const css = root.ownerDocument?.defaultView?.getComputedStyle(root);
	return css?.getPropertyValue("--text-normal").trim() || "var(--text-normal)";
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

function getLabel(entry: DateEntry): string {
	const summary = String(entry.summary ?? "").trim();
	if (summary) return summary;
	const parts = String(entry.file ?? "").split(/[\\/]/);
	return parts[parts.length - 1] || entry.file || "";
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

function computeItems(canvas: EpochCanvas): PinRenderItem[] {
	const s = state(canvas);
	const indexer = s.plugin?.indexer;
	const paths = typeof indexer?.getIndexedPaths === "function" ? indexer.getIndexedPaths() : [];
	const today = getToday();
	const layoutByIndex = new Map<number, DayLayout>();
	for (const layout of s.layouts ?? []) {
		layoutByIndex.set(layout.index, layout);
	}
	const width = TIMELINE_X - LABEL_OFFSET_X;
	const background = getBackgroundColor(s.root);
	const css = s.root.ownerDocument?.defaultView?.getComputedStyle(s.root);
	const fontMain = fontMinusPx(css?.getPropertyValue("--epoch-font-main").trim() || "12px var(--font-text)", PIN_FONT_DELTA_PX);
	const visible: PinRenderItem[] = [];
	const topDocked: PinRenderItem[] = [];
	const bottomDocked: PinRenderItem[] = [];

	for (const path of paths) {
		const data = indexer?.getFileIndexData?.(path) ?? null;
		const mode = getMode(data);
		if (!mode) continue;
		const entry = getAnchorEntry(data);
		if (!entry?.date) continue;
		const dayIndex = dayIndexForDate(entry.date, today);
		if (dayIndex == null) continue;
		const layout = layoutByIndex.get(dayIndex) ?? null;
		const targetY = layout
			? (layout.dateRect.y1 + layout.dateRect.y2) / 2
			: dayIndex * BASE_SPACING * s.scale + s.offsetY;
		const inViewport = targetY >= 0 && targetY <= s.root.clientHeight;
		if (mode === "date" && !inViewport) continue;
		const item: PinRenderItem = {
			key: `${path}:${mode}:${entry.date}`,
			entry,
			label: getLabel(entry),
			dayIndex,
			date: parseDateKey(entry.date) ?? today,
			fill: getFillColor(s, entry),
			text: background,
			left: 0,
			width,
			top: 0,
			opacity: inViewport ? PIN_VISIBLE_OPACITY : PIN_DOCK_OPACITY,
			font: fontMain,
			mode,
			targetY,
			dock: "none"
		};
		if (inViewport) {
			visible.push(item);
			continue;
		}
		if (targetY < 0) {
			item.dock = "top";
			topDocked.push(item);
			continue;
		}
		if (targetY > s.root.clientHeight) {
			item.dock = "bottom";
			bottomDocked.push(item);
			continue;
		}
	}

	positionVisible(visible);
	positionDocked(topDocked, "top", s.root.clientHeight);
	positionDocked(bottomDocked, "bottom", s.root.clientHeight);
	return [...visible, ...topDocked, ...bottomDocked];
}

function buildSignature(items: PinRenderItem[]): string {
	return items
		.map((item) => [item.key, item.top, item.opacity, item.label, item.fill, item.text, item.dock, item.font].join("|"))
		.join(";");
}

async function handleClick(canvas: EpochCanvas, item: PinRenderItem, ev: MouseEvent): Promise<void> {
	ev.preventDefault();
	ev.stopPropagation();
	const isOpenOnly = ev.ctrlKey || ev.metaKey || ev.button === 1;
	if (!isOpenOnly) {
		if (Platform.isMobile) {
			snapToDate(canvas, item.date);
		} else {
			focusDateWithZoom(canvas, item.date, true, false);
		}
	}
	await openEntry(canvas, item.entry, ev, true);
	const s = state(canvas);
	s.keepHoverAfterMenu = false;
	s.clearHover(true);
}

function showPinSummaryMenu(canvas: EpochCanvas, item: PinRenderItem, clientX: number, clientY: number): void {
	const s = state(canvas);
	if (typeof s.showSummaryMenu !== "function") return;
	s.keepHoverAfterMenu = true;
	s.showSummaryMenu(item.entry, clientX, clientY);
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
		button.setAttribute("aria-label", item.label || item.entry.file);
		button.style.left = `${item.left}px`;
		button.style.top = `${item.top}px`;
		button.style.width = `${item.width}px`;
		button.style.height = `${PIN_HEIGHT}px`;
		button.style.opacity = `${item.opacity}`;
		button.style.setProperty("--epoch-pin-fill", item.fill);
		button.style.setProperty("--epoch-pin-text", item.text);
		if (item.dock !== "none") button.classList.add(`is-${item.dock}`);
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
		let longPressTimer: number | null = null;
		let longPressFired = false;
		const clearLongPress = () => {
			if (longPressTimer != null) {
				window.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
		};
		button.addEventListener("touchstart", (ev) => {
			if (!ev.touches || ev.touches.length !== 1) return;
			clearLongPress();
			longPressFired = false;
			const t = ev.touches[0];
			longPressTimer = window.setTimeout(() => {
				longPressTimer = null;
				longPressFired = true;
				showPinSummaryMenu(canvas, item, t.clientX, t.clientY);
			}, LONG_PRESS_MS);
		}, { passive: true });
		button.addEventListener("touchmove", () => {
			clearLongPress();
		});
		button.addEventListener("touchend", () => {
			clearLongPress();
		});
		button.addEventListener("touchcancel", () => {
			clearLongPress();
		});
		button.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			showPinSummaryMenu(canvas, item, ev.clientX, ev.clientY);
		});
		button.addEventListener("click", (ev) => {
			if (longPressFired) {
				longPressFired = false;
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
			void handleClick(canvas, item, ev);
		});
		button.addEventListener("auxclick", (ev) => {
			if (ev.button !== 1) return;
			void handleClick(canvas, item, ev);
		});
	}
}