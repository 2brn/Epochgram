import type { EpochCanvas } from "../epoch-canvas";

export interface CanvasMenuState {
	plugin: any;
	keepHoverAfterMenu: boolean;
	clearHover(force?: boolean): void;
	refreshIndex(): void;
	hasProAccess(): boolean;
	requirePro(feature: string): boolean;
}

export function getMenuState(canvas: EpochCanvas): CanvasMenuState {
	return canvas as unknown as CanvasMenuState;
}
