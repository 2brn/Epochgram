import type { DateEntry } from "../../indexer/types";
import { BASE_SPACING, TOUCH_HIT_PAD } from "../epoch-canvas-constants";
import type { EpochCanvas } from "../epoch-canvas";

type SummaryRect = {
	entry: DateEntry;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
};

type CanvasLayout = {
	index: number;
	summaryRects: SummaryRect[];
};

type PinFlyState = {
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
};

type CanvasPinFlyInternals = {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	root: HTMLElement;
	layouts: CanvasLayout[];
	win?: Window;
	scale: number;
	offsetY: number;
	pinFly: PinFlyState | null;
	pinFlyOnDone: (() => void) | null;
	requestHoverAnimation(): void;
};

const activeDocument: Document =
	window.document;


export function startPinFlyToToday(canvas: EpochCanvas, entry: DateEntry, onDone?: () => void): boolean {
	try {
		if (!entry) return false;
		const c = canvas as unknown as CanvasPinFlyInternals;
		if (!c.canvas || !c.ctx) return false;

		let rect: { x1: number; y1: number; x2: number; y2: number } | null = null;
		let fromLayoutIndex: number | null = null;
		for (const layout of c.layouts ?? []) {
			for (const r of layout.summaryRects ?? []) {
				if (r.entry === entry) {
					rect = r;
					fromLayoutIndex = typeof layout?.index === "number" ? layout.index : null;
					break;
				}
				if (
					r?.entry?.file === entry.file &&
					r?.entry?.date === entry.date &&
					r?.entry?.source === entry.source &&
					(r?.entry?.blockStart ?? -1) === (entry.blockStart ?? -1) &&
					(r?.entry?.blockEnd ?? -1) === (entry.blockEnd ?? -1)
				) {
					rect = r;
					fromLayoutIndex = typeof layout?.index === "number" ? layout.index : null;
					break;
				}
			}
			if (rect) break;
		}
		if (!rect) return false;
		// If the record is already on Today, pinning should be immediate (no fly animation).
		if (fromLayoutIndex === 0) return false;

		// summaryRects are hit-test rects and include TOUCH_HIT_PAD.
		// For the pin-fly snapshot, capture only the rendered row bounds so we don't
		// grab (and "move") pixels from neighboring records.
		const pad = Math.max(0, Number(TOUCH_HIT_PAD) || 0);
		const innerPad = 1;
		const x1 = Number(rect.x1) + pad - innerPad;
		const y1 = Number(rect.y1) + pad - innerPad;
		const x2 = Number(rect.x2) - pad + innerPad;
		const y2 = Number(rect.y2) - pad + innerPad;
		if (![x1, y1, x2, y2].every(Number.isFinite)) return false;

		const rootRect = c.root.getBoundingClientRect();
		const maxW = Math.max(0, rootRect.width);
		const maxH = Math.max(0, rootRect.height);
		if (!maxW || !maxH) return false;

		const clippedX1 = Math.max(0, Math.min(maxW, x1));
		const clippedY1 = Math.max(0, Math.min(maxH, y1));
		const clippedX2 = Math.max(0, Math.min(maxW, x2));
		const clippedY2 = Math.max(0, Math.min(maxH, y2));
		const clippedWCss = Math.max(1, clippedX2 - clippedX1);
		const clippedHCss = Math.max(1, clippedY2 - clippedY1);
		if (clippedWCss <= 1 || clippedHCss <= 1) return false;

		const w = c.win ?? window;
		const dpr = (typeof w.devicePixelRatio === "number" ? w.devicePixelRatio : window.devicePixelRatio) || 1;
		const sx = Math.max(0, Math.floor(clippedX1 * dpr));
		const sy = Math.max(0, Math.floor(clippedY1 * dpr));
		const sw = Math.max(1, Math.floor(clippedWCss * dpr));
		const sh = Math.max(1, Math.floor(clippedHCss * dpr));
		if (!sw || !sh) return false;

		let imgData: ImageData | null = null;
		try {
			imgData = c.ctx.getImageData(sx, sy, sw, sh);
		} catch {
			imgData = null;
		}
		if (!imgData) return false;

		const off = activeDocument.createElement("canvas");
		off.width = sw;
		off.height = sh;
		const offCtx = off.getContext("2d");
		if (!offCtx) return false;
		try {
			offCtx.putImageData(imgData, 0, 0);
		} catch {
			return false;
		}

		const now = window.performance.now();
		const todayLayout = (c.layouts ?? []).find((l) => l.index === 0) ?? null;
		const todayFirst = todayLayout?.summaryRects?.[0] ?? null;
		const toX = todayFirst ? (Number(todayFirst.x1) + pad - innerPad) : clippedX1;
		const toY = todayFirst
			? (Number(todayFirst.y1) + pad - innerPad)
			: (0 * BASE_SPACING * c.scale + c.offsetY - clippedHCss / 2);
		c.pinFly = {
			img: off,
			fromX: clippedX1,
			fromY: clippedY1,
			toX: Number.isFinite(toX) ? toX : clippedX1,
			toY: Number.isFinite(toY) ? toY : (0 * BASE_SPACING * c.scale + c.offsetY - clippedHCss / 2),
			w: clippedWCss,
			h: clippedHCss,
			startAt: now,
			durationMs: 420,
			t: 0
		};
		c.pinFlyOnDone = typeof onDone === "function" ? onDone : null;
		c.requestHoverAnimation();
		return true;
	} catch {
		// ignore
	}
	return false;
}
