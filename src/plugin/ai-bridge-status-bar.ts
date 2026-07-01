import { Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { setCssStyles } from "../dom";
import { hasAiBridgeAccess } from "./pro-feature-state";

import { AI_BRIDGE_GLYPH } from "./icons";

type StatusBarBridgePlugin = EpochPlugin & {
	__epochStatusBarAiBridgeEl?: HTMLElement | null;
	__epochStatusBarAiBridgeClickBound?: boolean;
	aiBridge?: {
		getStatus?: () => { clientConnected: boolean };
	} | null;
	openAiBridgeWindow?: (options?: { silent?: boolean; source?: string; forceOpen?: boolean }) => void;
	addStatusBarItem?: () => HTMLElement;
};

type WindowWithHTMLElement = Window & {
	HTMLElement?: typeof HTMLElement;
};

function getEl(plugin: EpochPlugin): HTMLElement | null {
	if (!Platform.isDesktopApp || Platform.isMobileApp) return null;
	const state = plugin as StatusBarBridgePlugin;
	const cached = state.__epochStatusBarAiBridgeEl;
	try {
		const HTMLElementAny = (window as WindowWithHTMLElement).HTMLElement;
		if (cached && (typeof HTMLElementAny === "undefined" || cached.instanceOf(HTMLElementAny))) {
			return cached;
		}
	} catch {
		// ignore
	}
	try {
		if (typeof state.addStatusBarItem !== "function") return null;
		const el: HTMLElement = state.addStatusBarItem();
		setCssStyles(el, { display: "none" });
		el.addClass?.("epoch-status-progress");
		el.addClass?.("epoch-status-bridge");
		try {
			el.setAttribute("aria-label", "AI bridge");
			el.setAttribute("data-tooltip-position", "top");
		} catch {
			// ignore
		}
		state.__epochStatusBarAiBridgeEl = el;
		return el;
	} catch {
		return null;
	}
}

export function refreshAiBridgeStatusBar(plugin: EpochPlugin): void {
	const el = getEl(plugin);
	if (!el) return;

	let shouldShow = false;
	try {
		shouldShow = hasAiBridgeAccess(plugin);
	} catch {
		shouldShow = false;
	}

	if (!shouldShow) {
		setCssStyles(el, { display: "none" });
		return;
	}

	const bridge = (plugin as StatusBarBridgePlugin).aiBridge ?? null;
	if (!bridge) {
		setCssStyles(el, { display: "none" });
		return;
	}
	let status: { clientConnected: boolean } | null = null;
	try {
		status = bridge?.getStatus?.() ?? null;
	} catch {
		status = null;
	}
	const clientConnected = status?.clientConnected === true;
	const disconnected = !clientConnected;

	try {
		el.removeClass?.("is-warning");
		el.removeClass?.("is-connected");
		if (clientConnected) {
			el.addClass?.("is-connected");
		} else if (disconnected) {
			// Red when the bridge page isn't connected.
			el.addClass?.("is-warning");
		}
	} catch {
		// ignore
	}

	// Keep the bridge button minimal; AI job progress shows in the shared progress indicator.
	el.textContent = `${AI_BRIDGE_GLYPH} AI`;
	try {
		setCssStyles(el, { cursor: "pointer" });
	} catch {
		// ignore
	}

	try {
		if (disconnected) {
			el.setAttribute("aria-label", "AI bridge (disconnected)");
		} else {
			el.setAttribute("aria-label", "AI bridge");
		}
	} catch {
		// ignore
	}

	setCssStyles(el, { display: "" });
}

export function initAiBridgeStatusBar(plugin: EpochPlugin): void {
	const el = getEl(plugin);
	if (!el) return;

	const state = plugin as StatusBarBridgePlugin;
	try {
		if (!state.__epochStatusBarAiBridgeClickBound) {
			state.__epochStatusBarAiBridgeClickBound = true;
			el.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				try {
					void state.openAiBridgeWindow?.({ silent: false, source: "command", forceOpen: true });
				} catch {
					// ignore
				}
			});
		}
	} catch {
		// ignore
	}

	try {
		refreshAiBridgeStatusBar(plugin);
	} catch {
		// ignore
	}
}
