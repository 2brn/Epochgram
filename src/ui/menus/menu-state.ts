import type { EpochCanvas } from "../epoch-canvas";
import type { EpochPlugin } from "../../main";

export interface CanvasMenuState {
	plugin: EpochPlugin;
	keepHoverAfterMenu: boolean;
	clearHover(force?: boolean): void;
	refreshIndex(): void;
	hasProAccess(): boolean;
	requirePro(feature: string): boolean;
}

export function getMenuState(canvas: EpochCanvas): CanvasMenuState {
	return canvas as unknown as CanvasMenuState;
}
