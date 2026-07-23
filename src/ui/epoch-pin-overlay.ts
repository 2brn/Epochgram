import { Platform } from "obsidian";
import type { DateEntry, FileIndexData, PinMode } from "../indexer/types";
import type { EpochIndex } from "../indexer/types";
import type { EpochCanvas } from "./epoch-canvas";
import type { DayLayout } from "./epoch-canvas-types";
import { BASE_SPACING, LABEL_OFFSET_X, LONG_PRESS_MS, TIMELINE_X } from "./epoch-canvas-constants";
import { openEntry } from "./epoch-canvas-actions";
import { beginAnchorEntryDrag, commitAnchorEntryDrag, updateAnchorEntryDrag } from "./epoch-canvas-events/anchor-dnd";
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
	draw?: () => void;
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
const PIN_DOUBLE_TAP_MS = 260;
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
	const today = getToday();
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
		const targetY = dayIndex * BASE_SPACING * s.scale + s.offsetY;
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
		const off = doc.createElement("canvas");
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

async function handleOpenOnly(canvas: EpochCanvas, item: PinRenderItem, ev: MouseEvent): Promise<void> {
	ev.preventDefault();
	ev.stopPropagation();
	await openEntry(canvas, item.entry, ev, true);
	const s = state(canvas);
	s.keepHoverAfterMenu = false;
	s.clearHover(true);
}

function handleFocusOnly(canvas: EpochCanvas, item: PinRenderItem, ev: MouseEvent): void {
	ev.preventDefault();
	ev.stopPropagation();
	if (Platform.isMobile) {
		focusDateWithZoom(canvas, item.date, true, false);
	} else {
		focusDateWithZoom(canvas, item.date, true, false);
	}
	const s = state(canvas);
	s.keepHoverAfterMenu = false;
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
		let singleTapTimer: number | null = null;
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
			if (!ev.touches || ev.touches.length !== 1) return;
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
				touchDragMenu = showPinSummaryMenu(canvas, button, item, t.clientX, t.clientY);
			}, LONG_PRESS_MS);
		}, { passive: true });
		button.addEventListener("touchmove", (ev) => {
			if (!ev.touches || ev.touches.length !== 1) {
				clearLongPress();
				return;
			}
			const t = ev.touches[0];
			if (!longPressFired) {
				const dx0 = t.clientX - touchStartX;
				const dy0 = t.clientY - touchStartY;
				if (Math.hypot(dx0, dy0) > 12) clearLongPress();
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
			if (singleTapTimer != null) {
				window.clearTimeout(singleTapTimer);
				singleTapTimer = null;
				handleFocusOnly(canvas, item, ev);
				return;
			}
			singleTapTimer = window.setTimeout(() => {
				singleTapTimer = null;
				void handleOpenOnly(canvas, item, ev);
			}, PIN_DOUBLE_TAP_MS);
		});
		button.addEventListener("dblclick", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
		});
		button.addEventListener("auxclick", (ev) => {
			if (ev.button !== 1) return;
			if (singleTapTimer != null) {
				window.clearTimeout(singleTapTimer);
				singleTapTimer = null;
			}
			void handleOpenOnly(canvas, item, ev);
		});
	}
}