import type { EpochCanvas } from "../epoch-canvas";

export function ensureSizeMatchesDisplay(canvas: EpochCanvas): void {
	try {
		const w: any = (canvas as any).win ?? window;
		if (!(canvas as any).root?.isConnected) return;
		const rect = (canvas as any).canvas?.getBoundingClientRect?.();
		const cssWidth = rect?.width ?? 0;
		const cssHeight = rect?.height ?? 0;
		if (!cssWidth || !cssHeight) return;
		const dpr = w.devicePixelRatio || 1;
		const wantW = Math.round(cssWidth * dpr);
		const wantH = Math.round(cssHeight * dpr);
		if (!wantW || !wantH) return;
		if ((canvas as any).canvas.width !== wantW || (canvas as any).canvas.height !== wantH) {
			(canvas as any).resize();
		}
	} catch {
		// ignore
	}
}

export function scheduleResize(canvas: EpochCanvas): void {
	const w: any = (canvas as any).win ?? window;
	try {
		if ((canvas as any).postResizeTimeout1 != null) {
			w.clearTimeout((canvas as any).postResizeTimeout1);
			(canvas as any).postResizeTimeout1 = null;
		}
		if ((canvas as any).postResizeTimeout2 != null) {
			w.clearTimeout((canvas as any).postResizeTimeout2);
			(canvas as any).postResizeTimeout2 = null;
		}
	} catch {
		// ignore
	}
	if ((canvas as any).resizeScheduled) return;
	(canvas as any).resizeScheduled = true;
	try {
		w.requestAnimationFrame(() => {
			(canvas as any).resizeScheduled = false;
			(canvas as any).resize();
			try {
				if (!(canvas as any).root?.isConnected) return;
				(canvas as any).postResizeTimeout1 = w.setTimeout(() => {
					if (!(canvas as any).root?.isConnected) return;
					try {
						(canvas as any).resize();
					} catch {
						// ignore
					}
				}, 50);
				(canvas as any).postResizeTimeout2 = w.setTimeout(() => {
					if (!(canvas as any).root?.isConnected) return;
					try {
						(canvas as any).resize();
					} catch {
						// ignore
					}
				}, 250);
			} catch {
				// ignore
			}
		});
	} catch {
		(canvas as any).resizeScheduled = false;
		try {
			(canvas as any).resize();
		} catch {
			// ignore
		}
	}
}
