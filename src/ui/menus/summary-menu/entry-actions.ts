import { Menu, TFile } from "obsidian";
import type { DateEntry, ReviewState } from "../../../indexer/types";
import { normalizeReviewState } from "../../../indexer/review-state";
import type { EpochCanvas } from "../../epoch-canvas";
import type { CanvasMenuState } from "../menu-state";
import { deleteEntryFile, promptMoveFile, promptRenameFile } from "../../epoch-canvas-actions";
import { promptEditSummary } from "../../modals/edit-summary-modal";
import { addMenuTitle } from "../menu-title";
export function addOpenFile(menu: Menu, _canvas: EpochCanvas, _entry: DateEntry, title: string): void { addMenuTitle(menu, title, "file"); menu.addSeparator(); }
export function addEditSummary(menu: Menu, state: CanvasMenuState, entry: DateEntry, title: string): void {
	const plugin = state.plugin;
	if (!/\.md$/i.test(entry.file) || plugin.settings.summaryWordsCount <= 0) return;
	menu.addItem(item => item.setTitle("Edit summary…").setIcon("square-pen").onClick(async () => {
		const initialValue = await plugin.getYamlDescriptionForPath(entry.file) || entry.summary;
		const value = await promptEditSummary(plugin.app, { title: `Edit summary ${title}`, initialValue, maxChars: 240 });
		if (value == null || !await plugin.setYamlDescriptionForPath(entry.file, value.trim())) return;
		await plugin.persistIndex({ skipEnsure: true }); state.clearHover(true); state.refreshIndex();
	}));
}
export function addReviewActions(menu: Menu, state: CanvasMenuState, entry: DateEntry): void {
	const current = normalizeReviewState(entry.reviewState);
	const actions: Array<{ title: string; icon: string; value: ReviewState }> = [
		{ title: "Review", icon: "eye", value: "reviewed" },
		{ title: "Draft", icon: "pencil-ruler", value: "draft" },
		{ title: current === "hidden" ? "Unhide" : "Hide", icon: current === "hidden" ? "eye" : "eye-off", value: current === "hidden" ? "draft" : "hidden" }
	];
	for (const action of actions) menu.addItem(item => item.setTitle(action.title).setIcon(action.icon).setDisabled(current === action.value).onClick(async () => {
		await state.plugin.setEntryReview(entry, action.value); state.clearHover(true); state.refreshIndex();
	}));
}
export function addPinToggle(menu: Menu, state: CanvasMenuState, entry: DateEntry, pinned: boolean): void {
	menu.addItem(item => item.setTitle(pinned ? "Unpin" : "Pin").setIcon(pinned ? "pin-off" : "pin").onClick(async () => {
		const apply = async () => {
			if (!state.plugin.indexer.setEntryPinned(entry, !pinned)) return;
			state.clearHover(true); state.refreshIndex(); await state.plugin.persistIndex({ skipEnsure: true });
		};
		const anim = state as CanvasMenuState & { startPinFlyToToday?: (entry: DateEntry, done: () => void) => boolean };
		if (!pinned && anim.startPinFlyToToday?.(entry, () => { void apply(); })) return;
		await apply();
	}));
}
export function addFileRenameMove(menu: Menu, state: CanvasMenuState, canvas: EpochCanvas, entry: DateEntry): void {
	const file = state.plugin.app.vault.getAbstractFileByPath(entry.file);
	if (!(file instanceof TFile)) return;
	menu.addItem(item => item.setTitle("Rename…").setIcon("pen-line").onClick(async () => { if (await promptRenameFile(canvas, file)) { state.clearHover(true); state.refreshIndex(); } }));
	menu.addItem(item => item.setTitle("Move to…").setIcon("folder-tree").onClick(async () => { if (await promptMoveFile(canvas, file)) { state.clearHover(true); state.refreshIndex(); } }));
}
export function addDelete(menu: Menu, _state: CanvasMenuState, canvas: EpochCanvas, entry: DateEntry): void {
	menu.addSeparator();
	menu.addItem(item => {
		item.setTitle("Delete").setIcon("trash").onClick(async () => { await deleteEntryFile(canvas, entry); });
		(item as unknown as { dom?: HTMLElement }).dom?.classList.add("epoch-menu-danger");
	});
}
