import type { EpochCanvas } from "../epoch-canvas";

type ResizeCanvasState = {
	win?: Window;
	root?: HTMLElement;
	canvas?: HTMLCanvasElement;
	postResizeTimeout1?: number | null;
	postResizeTimeout2?: number | null;
	resizeScheduled?: boolean;
	resize(): void;
};

function state(canvas: EpochCanvas): ResizeCanvasState {
	return canvas as unknown as ResizeCanvasState;
}

export function ensureSizeMatchesDisplay(canvas: EpochCanvas): void {
	const c = state(canvas);
	try {
		const w = c.win ?? window;
		if (!c.root?.isConnected) return;
		const rect = c.canvas?.getBoundingClientRect?.();
		const cssWidth = rect?.width ?? 0;
		const cssHeight = rect?.height ?? 0;
		if (!cssWidth || !cssHeight) return;
		const dpr = w.devicePixelRatio || 1;
		const wantW = Math.round(cssWidth * dpr);
		const wantH = Math.round(cssHeight * dpr);
		if (!wantW || !wantH) return;
		if (c.canvas && (c.canvas.width !== wantW || c.canvas.height !== wantH)) {
			c.resize();
		}
	} catch {
		// ignore
	}
}

export function scheduleResize(canvas: EpochCanvas): void {
	const c = state(canvas);
	const w = c.win ?? window;
	try {
		if (c.postResizeTimeout1 != null) {
			w.clearTimeout(c.postResizeTimeout1);
			c.postResizeTimeout1 = null;
		}
		if (c.postResizeTimeout2 != null) {
			w.clearTimeout(c.postResizeTimeout2);
			c.postResizeTimeout2 = null;
		}
	} catch {
		// ignore
	}
	if (c.resizeScheduled) return;
	c.resizeScheduled = true;
	try {
		w.requestAnimationFrame(() => {
			c.resizeScheduled = false;
			c.resize();
			try {
				if (!c.root?.isConnected) return;
				c.postResizeTimeout1 = w.setTimeout(() => {
					if (!c.root?.isConnected) return;
					try {
						c.resize();
					} catch {
						// ignore
					}
				}, 50);
				c.postResizeTimeout2 = w.setTimeout(() => {
					if (!c.root?.isConnected) return;
					try {
						c.resize();
					} catch {
						// ignore
					}
				}, 250);
			} catch {
				// ignore
			}
		});
	} catch {
		c.resizeScheduled = false;
		try {
			c.resize();
		} catch {
			// ignore
		}
	}
}
