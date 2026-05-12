import type { EpochPlugin } from "../main";
import { ensureEpochViewLeaf, onViewUnload, openEpochView, openTimelineSearch, refreshEpochViews } from "./view/leaf-actions";
import { registerFileMenu } from "./view/file-menu";

export interface ViewMethods {
	onunload(): void;
	openEpochView(): Promise<void>;
	openTimelineSearch(): Promise<void>;
	ensureEpochViewLeaf(): Promise<void>;
	refreshEpochViews(options?: { forceSemanticRelated?: boolean }): void;
	registerFileMenu(): void;
}

export const viewMethods: ViewMethods = {
	onunload(this: EpochPlugin): void {
		onViewUnload(this);
	},

	async openEpochView(this: EpochPlugin): Promise<void> {
		await openEpochView(this);
	},

	async openTimelineSearch(this: EpochPlugin): Promise<void> {
		await openTimelineSearch(this);
	},

	async ensureEpochViewLeaf(this: EpochPlugin): Promise<void> {
		await ensureEpochViewLeaf(this);
	},

	refreshEpochViews(this: EpochPlugin, options?: { forceSemanticRelated?: boolean }): void {
		refreshEpochViews(this, options ?? {});
	},

	registerFileMenu(this: EpochPlugin): void {
		registerFileMenu(this);
	}
};
