import { Platform } from "obsidian";
import type { EpochCanvas } from "../epoch-canvas";

import { refreshSemanticRelatedForActiveFile } from "./semantic";

export function suppressNextFocusScrollForPath(canvas: EpochCanvas, path: string | null): void {
	const c: any = canvas as any;
	c.suppressNextFocusScroll = path;
}

export function clearFocusedEpochRange(canvas: EpochCanvas): void {
	const c: any = canvas as any;
	if (!c.focusedEpochRange) return;
	c.focusedEpochRange = null;
}

export function setActiveFile(
	canvas: EpochCanvas,
	path: string | null,
	line: number | null = null,
	options?: { suppressFocus?: boolean }
): void {
	const c: any = canvas as any;
	if (c.pendingActiveFileFocus && c.pendingActiveFileFocus.path !== path) {
		c.pendingActiveFileFocus = null;
	}
	if (path !== c.activeFilePath) {
		clearFocusedEpochRange(canvas);
	}
	const suppressFocusFlag = !!path && c.suppressNextFocusScroll === path;
	if (c.activeFilePath !== path) {
		if (!suppressFocusFlag) {
			c.scrollNavIndex = -1;
			c.scrollNavFile = null;
			c.pendingScrollNavHighlight = null;
			c.scrollNavAnchorEntry = null;
			c.scrollNavAnchorDayIndex = null;
			try {
				(c as any).__scrollNavAnchorMode = null;
			} catch {
				// ignore
			}
		} else if (path) {
			c.scrollNavFile = path;
		}
	}
	if (suppressFocusFlag) {
		c.suppressNextFocusScroll = null;
	}
	const suppressFocus = options?.suppressFocus === true || !!suppressFocusFlag;
	if (c.activeFilePath === path) {
		// If the canvas pre-initialized activeFilePath (e.g. view opened after a file was
		// already active), we still need to compute semantic-related highlights.
		refreshSemanticRelatedForActiveFile(canvas, false);
		return;
	}
	c.activeFilePath = path;
	refreshSemanticRelatedForActiveFile(canvas, true);
	if (path) {
		const rootHovered = c.root.matches(":hover");
		const pointerCapable = (() => {
			try {
				return typeof c.isPointerDeviceEvent === "function" ? !!c.isPointerDeviceEvent() : true;
			} catch {
				return true;
			}
		})();
		const effectiveRootHovered = pointerCapable ? rootHovered : false;
		const suppressHover = c.suppressNextFocusHover === path;
		const forceHover = c.forceNextFocusHover === path;
		let useHoverHighlight = forceHover || effectiveRootHovered;
		if (suppressHover) {
			useHoverHighlight = false;
		}
		let focused = false;
		if (!suppressFocus) {
			if (Platform.isMobileApp) {
				try {
					c.pendingActiveFileFocus = null;
					c.snapInitialPosition(path, line, { draw: true });
					focused = true;
				} catch {
					focused = false;
				}
			}
			if (!focused) {
			try {
				const rect = c.root?.getBoundingClientRect?.();
				if (!rect || !rect.width || !rect.height) {
					const cachedW0 = Number(c.__lastKnownCanvasCssWidth ?? 0);
					const cachedH0 = Number(c.__lastKnownCanvasCssHeight ?? 0);
					const cachedW = Number.isFinite(cachedW0) ? cachedW0 : 0;
					const cachedH = Number.isFinite(cachedH0) ? cachedH0 : 0;
					// If we have a previous known size, we can still compute scroll target immediately
					// (useful on mobile where the timeline panel is often collapsed).
					if (!(cachedW > 0 && cachedH > 0)) {
						c.pendingActiveFileFocus = { path, line };
						c.pendingVisibilityDraw = true;
						c.scheduleVisibilityCheck();
						return;
					}
					// Still schedule a visibility check so a draw occurs once the panel reappears.
					c.pendingVisibilityDraw = true;
					c.scheduleVisibilityCheck();
				}
			} catch {
				// ignore
			}
			focused = c.focusFile(path, line, useHoverHighlight);
			if (!focused) {
				try {
					c.pendingActiveFileFocus = { path, line };
					c.pendingVisibilityDraw = true;
					c.scheduleVisibilityCheck();
				} catch {
					// ignore
				}
			}
			}
		}
		if (suppressHover && focused) {
			c.suppressNextFocusHover = null;
		}
		if (forceHover && focused) {
			c.forceNextFocusHover = null;
		}
		if (suppressFocus) {
			c.suppressNextFocusHover = null;
			c.forceNextFocusHover = null;
		}
	} else {
		c.suppressNextFocusScroll = null;
	}
}
