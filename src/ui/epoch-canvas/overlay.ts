import type { EpochCanvas } from "../epoch-canvas";
import { BASE_SPACING, DATE_OVERLAY_VISIBILITY_MS } from "../epoch-canvas-constants";

type DateOverlaySummary = { dayIndex?: number | null } | null;

type OverlayPluginState = {
	settings?: {
		enableAnimation?: boolean;
	};
};

type OverlayCanvasState = {
	plugin?: OverlayPluginState;
	dateOverlayEl: HTMLElement | null;
	dateOverlayTimer: number | null;
	scale: number;
	offsetY: number;
	hoverSummary: DateOverlaySummary;
	hoverDateIndex: number | null;
	lastDateOverlayHoverKey: string;
	lastOverlayOffsetY: number;
	lastOverlayScale: number;
	lastDateOverlayValue: string;
	getDateForIndex(dayIndex: number, today: Date): Date;
	getToday(): Date;
};

function asOverlayState(canvas: EpochCanvas): OverlayCanvasState {
	return canvas as unknown as OverlayCanvasState;
}

function areOverlayAnimationsEnabled(canvas: EpochCanvas): boolean {
	try {
		const c = asOverlayState(canvas);
		return c.plugin?.settings?.enableAnimation !== false;
	} catch {
		return true;
	}
}

function syncDateOverlayMotionStyle(canvas: EpochCanvas): void {
	const c = asOverlayState(canvas);
	const el = c.dateOverlayEl;
	if (!el) return;
	const animationsEnabled = areOverlayAnimationsEnabled(canvas);
	el.style.transition = animationsEnabled ? "" : "none";
}

export function computeDateOverlayLabel(canvas: EpochCanvas): string | null {
	const c = asOverlayState(canvas);
	if (!c.dateOverlayEl) return null;
	if (!Number.isFinite(c.scale) || c.scale === 0) {
		return null;
	}
	const formatDate = (date: Date): string => {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	};

	// Hover behavior: when hovering a record or date marker, show that day.
	try {
		const hoverSummary = c.hoverSummary ?? null;
		const hoverDateIndex = c.hoverDateIndex ?? null;
		const hoverDayIndex =
			hoverSummary && Number.isFinite(hoverSummary.dayIndex)
				? Number(hoverSummary.dayIndex)
				: (hoverDateIndex != null && Number.isFinite(hoverDateIndex))
					? Number(hoverDateIndex)
					: null;
		if (hoverDayIndex != null) {
			const date = c.getDateForIndex(hoverDayIndex, c.getToday());
			return formatDate(date);
		}
	} catch {
		// ignore
	}

	const anchorScreenY = getDateOverlayAnchorScreenY(canvas);
	const anchorWorldY = (anchorScreenY - c.offsetY) / c.scale;
	if (!Number.isFinite(anchorWorldY)) {
		return null;
	}
	const anchorDayIndex = Math.round(anchorWorldY / BASE_SPACING);
	const date = c.getDateForIndex(anchorDayIndex, c.getToday());
	return formatDate(date);
}

export function getDateOverlayAnchorScreenY(canvas: EpochCanvas): number {
	const c = asOverlayState(canvas);
	const el = c.dateOverlayEl;
	if (!el) return 0;
	const offsetTop = el.offsetTop || 0;
	const height = el.offsetHeight || 0;
	return offsetTop + height / 2;
}

export function showDateOverlay(canvas: EpochCanvas): void {
	const c = asOverlayState(canvas);
	const el = c.dateOverlayEl;
	if (!el) return;
	syncDateOverlayMotionStyle(canvas);
	if (c.dateOverlayTimer != null) {
		window.clearTimeout(c.dateOverlayTimer);
		c.dateOverlayTimer = null;
	}
	el.classList.add("is-visible");
	c.dateOverlayTimer = window.setTimeout(() => {
		c.dateOverlayTimer = null;
		hideDateOverlay(canvas);
	}, DATE_OVERLAY_VISIBILITY_MS);
}

export function hideDateOverlay(canvas: EpochCanvas, immediate: boolean = false): void {
	const c = asOverlayState(canvas);
	const el = c.dateOverlayEl;
	if (!el) return;
	syncDateOverlayMotionStyle(canvas);
	const animationsEnabled = areOverlayAnimationsEnabled(canvas);
	const shouldHideImmediately = immediate || !animationsEnabled;
	if (c.dateOverlayTimer != null) {
		window.clearTimeout(c.dateOverlayTimer);
		c.dateOverlayTimer = null;
	}
	if (shouldHideImmediately) {
		el.classList.remove("is-visible");
	} else {
		window.requestAnimationFrame(() => el.classList.remove("is-visible"));
	}
}

export function updateDateOverlay(canvas: EpochCanvas): void {
	const c = asOverlayState(canvas);
	const el = c.dateOverlayEl;
	if (!el) return;
	syncDateOverlayMotionStyle(canvas);
	const hoverKey = (() => {
		try {
			const hs = c.hoverSummary ?? null;
			if (hs && Number.isFinite(hs.dayIndex)) return `S:${Number(hs.dayIndex)}`;
			const hd = c.hoverDateIndex ?? null;
			if (hd != null && Number.isFinite(hd)) return `D:${Number(hd)}`;
			return "";
		} catch {
			return "";
		}
	})();
	const hoverChanged = String(c.lastDateOverlayHoverKey || "") !== hoverKey;
	const offsetChanged = Math.abs(c.offsetY - c.lastOverlayOffsetY) > 0.25;
	const scaleChanged = Math.abs(c.scale - c.lastOverlayScale) > 1e-4;
	const hovering = !!hoverKey;
	if (!hovering && !offsetChanged && !scaleChanged && !hoverChanged) return;

	c.lastDateOverlayHoverKey = hoverKey;
	if (hovering) {
		// While hovering, keep the overlay visible without using an auto-hide timer.
		if (c.dateOverlayTimer != null) {
			window.clearTimeout(c.dateOverlayTimer);
			c.dateOverlayTimer = null;
		}
		const label = computeDateOverlayLabel(canvas);
		if (!label) {
			hideDateOverlay(canvas, true);
			return;
		}
		if (label !== c.lastDateOverlayValue) {
			el.textContent = label;
			c.lastDateOverlayValue = label;
		}
		el.classList.add("is-visible");
		return;
	}
	// If hover just ended, hide immediately (scroll/zoom will re-show as needed).
	if (hoverChanged && !hoverKey) {
		hideDateOverlay(canvas, true);
		if (!offsetChanged && !scaleChanged) {
			return;
		}
	}
	c.lastOverlayOffsetY = c.offsetY;
	c.lastOverlayScale = c.scale;
	const label = computeDateOverlayLabel(canvas);
	if (!label) {
		hideDateOverlay(canvas, true);
		return;
	}
	if (label !== c.lastDateOverlayValue) {
		el.textContent = label;
		c.lastDateOverlayValue = label;
	}
	showDateOverlay(canvas);
}
