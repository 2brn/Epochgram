import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { setCssStyles } from "../dom";
export type EpochProgressKind = "index" | "search" | "review";
type Runtime = EpochPlugin & {
	__epochStatusBarProgressEl?: HTMLElement;
	__epochProgressByKind?: Partial<Record<EpochProgressKind, string>>;
	__epochCancelRequestedAt?: Partial<Record<EpochProgressKind, number>>;
};
function refresh(plugin: EpochPlugin): void {
	const state = plugin as Runtime;
	const el = state.__epochStatusBarProgressEl;
	if (!el) return;
	const text = state.__epochProgressByKind?.index || state.__epochProgressByKind?.search || state.__epochProgressByKind?.review || "";
	el.textContent = text;
	el.setAttribute("aria-label", text ? `${text} (click to cancel)` : "");
	setCssStyles(el, { display: text ? "" : "none", cursor: text ? "pointer" : "" });
}
export function initEpochStatusBarProgress(plugin: EpochPlugin): void {
	if (!Platform.isDesktop) return;
	const state = plugin as Runtime;
	if (state.__epochStatusBarProgressEl) return;
	const el = plugin.addStatusBarItem();
	el.addClass("epoch-status-progress");
	state.__epochStatusBarProgressEl = el;
	el.addEventListener("click", () => {
		const kind = state.__epochProgressByKind?.index ? "index" : state.__epochProgressByKind?.search ? "search" : state.__epochProgressByKind?.review ? "review" : null;
		if (!kind) return;
		(state.__epochCancelRequestedAt ??= {})[kind] = Date.now();
		clearEpochProgress(plugin, kind);
		new Notice("Canceled", 2500);
	});
	refresh(plugin);
}
export function setEpochProgress(plugin: EpochPlugin, kind: EpochProgressKind, text: string): void {
	initEpochStatusBarProgress(plugin);
	((plugin as Runtime).__epochProgressByKind ??= {})[kind] = text;
	refresh(plugin);
}
export function clearEpochProgress(plugin: EpochPlugin, kind: EpochProgressKind, _delayMs = 0): void {
	delete (plugin as Runtime).__epochProgressByKind?.[kind];
	refresh(plugin);
}
export function consumeCancelRequested(plugin: EpochPlugin, kind: EpochProgressKind): boolean {
	const map = (plugin as Runtime).__epochCancelRequestedAt;
	const requested = !!map?.[kind];
	if (map) delete map[kind];
	return requested;
}
