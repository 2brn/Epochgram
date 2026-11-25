import type { EpochCanvas } from "../epoch-canvas";
import { resetScrollNavTargetState } from "./scroll-nav-reset";
type State = { root: HTMLElement; showContentDates: boolean; showPropDates: boolean; showAttachments: boolean; showDraftsOnly: boolean; scrollNavFile: string | null; __scrollNavLastModeKey?: string | null; clearHover(force?: boolean): void; draw(): void; refreshRelatedForActiveFile?(force?: boolean): void };
function setFilter(canvas: EpochCanvas, key: "showContentDates" | "showPropDates" | "showAttachments" | "showDraftsOnly", value: boolean): void {
	const c = canvas as unknown as State;
	if (c[key] === value) return;
	c[key] = value;
	if (key === "showContentDates") c.root.classList.toggle("epoch-hide-content", !value);
	if (key === "showAttachments") { c.root.classList.toggle("epoch-show-attachments", value); c.refreshRelatedForActiveFile?.(true); }
	resetScrollNavTargetState(canvas); c.scrollNavFile = null; c.__scrollNavLastModeKey = null; c.clearHover(true); c.draw();
}
export function setShowDraftsOnly(canvas: EpochCanvas, value: boolean): void { setFilter(canvas, "showDraftsOnly", value); }
export function setShowContentDates(canvas: EpochCanvas, value: boolean): void { setFilter(canvas, "showContentDates", value); }
export function setShowPropDates(canvas: EpochCanvas, value: boolean): void { setFilter(canvas, "showPropDates", value); }
export function setShowAttachments(canvas: EpochCanvas, value: boolean): void { setFilter(canvas, "showAttachments", value); }
