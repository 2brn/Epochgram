import { Menu, Platform, TFile } from "obsidian";
import type { DateEntry, ReviewState } from "../../../indexer/types";
import type { EpochCanvas } from "../../epoch-canvas";
import type { CanvasMenuState } from "../menu-state";
import { deleteEntryFile, promptMoveFile, promptRenameFile } from "../../epoch-canvas-actions";
import { promptEditSummary } from "../../modals/edit-summary-modal";
import { hasSummarizeAIAccess } from "../../../plugin/pro-feature-state";
import { addMenuTitle } from "../menu-title";

export function addOpenFile(menu: Menu, canvas: EpochCanvas, entry: DateEntry, title: string): void {
	addMenuTitle(menu, title, "file");
	menu.addSeparator();
}

export function addSummarizeAi(menu: Menu, state: CanvasMenuState, entry: DateEntry): void {
	const isPro = hasSummarizeAIAccess((state as any).plugin);
	if (!String(entry.file ?? "").toLowerCase().endsWith(".md")) return;
	if (!Platform.isDesktopApp) return;
	const plugin = (state as any).plugin;
	const enabled = isPro && typeof plugin?.enqueueAiSummaryForEntry === "function";

	menu.addItem((item) => {
		item
			.setTitle(enabled ? "Summarize AI" : "Summarize AI (Pro)")
			.setIcon("sparkles")
			.setDisabled(!enabled)
			.onClick(() => {
				if (!isPro) {
					state.requirePro("Summarize AI");
					return;
				}
				plugin?.enqueueAiSummaryForEntry?.(entry, { force: true, showNotice: true });
			});
	});
}

export function addEditSummary(menu: Menu, state: CanvasMenuState, entry: DateEntry, title: string): void {
	if (!String(entry.file ?? "").toLowerCase().endsWith(".md")) return;
	const plugin = (state as any).plugin;
	const summaryWords = Math.max(0, plugin?.settings?.summaryWordsCount ?? 0);
	if (summaryWords <= 0) return;
	menu.addItem((item) => {
		item
			.setTitle("Edit summary…")
			.setIcon("square-pen")
			.setDisabled(false)
			.onClick(async () => {
				const indexer = plugin?.indexer;
				if (!plugin || typeof plugin.setYamlDescriptionForPath !== "function") return;
				const visibleSummary = String(entry.summary || (entry as any)?.aiSummary || "").trim();
				const initialValue = typeof plugin.getYamlDescriptionForPath === "function"
					? (await plugin.getYamlDescriptionForPath(entry.file)) || visibleSummary
					: visibleSummary;
				const v = await promptEditSummary(plugin.app, {
					title: `Edit summary ${title}`,
					initialValue,
					maxChars: 240
				});
				if (v == null) return;
				const normalized = String(v ?? "").trim();
				const wrote = await plugin.setYamlDescriptionForPath(entry.file, normalized);
				const cleared = typeof indexer?.clearFileSummaryState === "function"
					? indexer.clearFileSummaryState(entry.file)
					: false;
				const changed = wrote || cleared;
				if (!changed) return;
				if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
				state.clearHover(true);
				state.refreshIndex();
			});
	});
}

export function addPinToggle(menu: Menu, state: CanvasMenuState, entry: DateEntry, pinned: boolean): void {
	menu.addItem((item) => {
		item
			.setTitle(pinned ? "Unpin" : "Pin")
			.setIcon(pinned ? "pin-off" : "pin")
			.setDisabled(false)
			.onClick(async () => {
				const plugin = (state as any).plugin;
				const indexer = plugin?.indexer;
				if (!indexer || typeof indexer.setEntryPinned !== "function") return;

				if (!pinned) {
					let started = false;
					try {
						started = (state as any)?.startPinFlyToToday?.(entry, () => {
							void (async () => {
								try {
									if (!indexer.setEntryPinned(entry, true)) return;
									if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
								} catch {
									return;
								}
								try {
									state.clearHover(true);
									state.refreshIndex();
								} catch {
									// ignore
								}
							})();
						});
					} catch {
						started = false;
					}
					if (started) {
						return;
					}
				}

				const nextPinned = !pinned;
				if (!indexer.setEntryPinned(entry, nextPinned)) return;
				// If there's no animation (e.g., entry is already on Today), reflect the pin immediately.
				// Persist in the background to avoid UI delay.
				if (nextPinned) {
					state.clearHover(true);
					state.refreshIndex();
					if (typeof plugin?.persistIndex === "function") {
						void plugin.persistIndex({ skipEnsure: true });
					}
					return;
				}
				if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
				state.clearHover(true);
				state.refreshIndex();
			});
	});
}

function normalizeReviewState(v: any): ReviewState {
	if (v == null) return "draft";
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		return s === "draft" || s === "reviewed" || s === "hidden" ? (s as ReviewState) : "draft";
	}
	return "draft";
}

function reviewStateIcon(state: ReviewState): string {
	if (state === "reviewed") return "scan-eye";
	if (state === "hidden") return "eye-off";
	return "pencil-ruler";
}

export function addReviewSubmenu(menu: Menu, state: CanvasMenuState, entry: DateEntry, current: ReviewState): void {
	const normalizedCurrent = normalizeReviewState(current);
	const plugin = (state as any).plugin;
	const indexer = plugin?.indexer;
	const applyRecord = async (next: "draft" | "reviewed") => {
		if (!indexer || typeof indexer.setEntryReviewState !== "function") return;
		const changed = indexer.setEntryReviewState(entry, next);
		if (!changed) return;
		if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
		state.clearHover(true);
		state.refreshIndex();
	};
	const applyHidden = async () => {
		if (!indexer || typeof indexer.setEntryHidden !== "function") return;
		const changed = indexer.setEntryHidden(entry, true);
		if (!changed) return;
		if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
		state.clearHover(true);
		state.refreshIndex();
	};

	const isHidden = normalizedCurrent === "hidden";
	const actions: Array<"review" | "draft" | "hide"> =
		isHidden ? ["review", "draft"] : (normalizedCurrent === "draft" ? ["review", "hide"] : ["draft", "hide"]);

	for (const action of actions) {
		menu.addItem((item) => {
			if (action === "draft") {
				item
					.setTitle("Draft")
					.setIcon(reviewStateIcon("draft"))
					.setDisabled(false)
					.onClick(() => {
						void Promise.resolve(applyRecord("draft")).finally(() => {
							try {
								(menu as any)?.hide?.();
							} catch { void 0; }
						});
					});
				return;
			}
			if (action === "review") {
				item
					.setTitle("Review")
					.setIcon(reviewStateIcon("reviewed"))
					.setDisabled(false)
					.onClick(() => {
						void Promise.resolve(applyRecord("reviewed")).finally(() => {
							try {
								(menu as any)?.hide?.();
							} catch { void 0; }
						});
					});
				return;
			}
			item
				.setTitle("Hide")
				.setIcon(reviewStateIcon("hidden"))
				.setDisabled(false)
				.onClick(() => {
					void Promise.resolve(applyHidden()).finally(() => {
						try {
							(menu as any)?.hide?.();
						} catch { void 0; }
					});
				});
		});
	}
}

export function addFileRenameMove(menu: Menu, state: CanvasMenuState, canvas: EpochCanvas, entry: DateEntry): void {
	const plugin = (state as any).plugin;
	const af = plugin?.app?.vault?.getAbstractFileByPath?.(entry.file);
	if (!(af instanceof TFile)) return;

	menu.addItem((item) => {
		item
			.setTitle("Rename…")
			.setIcon("pen-line")
			.setDisabled(false)
			.onClick(async () => {
				const changed = await promptRenameFile(canvas, af);
				if (changed) {
					state.clearHover(true);
					state.refreshIndex();
				}
			});
	});

	menu.addItem((item) => {
		item
			.setTitle("Move to…")
			.setIcon("folder-tree")
			.setDisabled(false)
			.onClick(async () => {
				const changed = await promptMoveFile(canvas, af);
				if (changed) {
					state.clearHover(true);
					state.refreshIndex();
				}
			});
	});
}

export function addDelete(menu: Menu, state: CanvasMenuState, canvas: EpochCanvas, entry: DateEntry): void {
	void state;
	menu.addSeparator();
	menu.addItem((item) => {
		item
			.setTitle("Delete")
			.setIcon("trash")
			.setDisabled(false)
			.onClick(async () => {
				await deleteEntryFile(canvas, entry);
			});
		const dom: any = (item as any)?.dom;
		if (dom) {
			if (typeof dom.addClass === "function") dom.addClass("epoch-menu-danger");
			else dom.classList?.add?.("epoch-menu-danger");
		}
	});
}
