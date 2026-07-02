import type { TAbstractFile } from "obsidian";
import { Menu, TFile, TFolder } from "obsidian";
import { applyMarkColorWithContext } from "../mark-context";
import { setCssStyles } from "../../dom";
import { gatherFileEntries } from "../../indexer/entry-state";
import type { FileIndexData } from "../../indexer/types";
import {
	getEpochMarkColorGroups,
	getEpochMarkColorSet,
	normalizeMarkColorIndex
} from "../../ui/mark-colors";
import type { EpochPlugin } from "../../main";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);

type FileMenuItemLike = {
	setTitle(title: string): FileMenuItemLike;
	setIcon(icon: string): FileMenuItemLike;
	setDisabled(disabled: boolean): FileMenuItemLike;
	onClick(callback: () => void | Promise<void>): FileMenuItemLike;
	setSubmenu?(): Menu | null;
	dom?: HTMLElement & { addClass?: (name: string) => void };
	iconEl?: HTMLElement;
};

type FileMenuHideable = Menu & { onHide?: (callback: () => void) => void; hide?: () => void };

type FileMenuVaultLike = {
	getConfig?(name: string): unknown;
	getFiles?(): TFile[];
};

type FileMenuIndexLike = {
	isFileKnown?(path: string): boolean;
	isFilePinned(path: string): boolean;
	getFileMarkColor(path: string): number | null;
	getFileEmbeddingTerm?(path: string): unknown;
	setFileReviewStateForAllRecords?(path: string, next: "draft" | "reviewed"): boolean;
	setFileReviewStateForAllRecordsPreserveHidden?(path: string, next: "draft" | "reviewed"): boolean;
	isFileHidden?(path: string): boolean;
	setFileHidden?(path: string, hidden: boolean): boolean;
	toJSON?(): { files?: Record<string, FileIndexData | undefined> };
};

type FileMenuPluginLike = EpochPlugin & {
	indexReady?: boolean;
	indexer?: FileMenuIndexLike;
	app: {
		workspace: {
			containerEl?: HTMLElement;
			on(eventName: string, callback: (menu: Menu, file: TAbstractFile) => void): unknown;
			getActiveFile?: () => { path?: string } | null;
		};
		vault?: FileMenuVaultLike;
	};
	isExcludedPath?(path: string): boolean;
	toggleFilePin?(file: TFile, pinned: boolean): Promise<void>;
	ensureIndexLoaded?(): Promise<void>;
	waitForExcludedSync?(): Promise<void>;
	persistIndex?(options: { skipEnsure?: boolean }): Promise<void>;
	refreshEpochViews?(): void;
	__epochInheritedMarkIndexByPath?: Map<string, number | null | undefined>;
};

function hideContextMenu(menu: FileMenuHideable): void {
	try {
		menu.hide?.();
	} catch { void 0; }
}

async function persistAndRefresh(pluginState: FileMenuPluginLike): Promise<void> {
	try {
		if (typeof pluginState.persistIndex === "function") await pluginState.persistIndex({ skipEnsure: true });
	} catch {
		// ignore
	}
	try {
		pluginState.refreshEpochViews?.();
	} catch {
		// ignore
	}
}

async function ensureReady(pluginState: FileMenuPluginLike): Promise<void> {
	try {
		await pluginState.ensureIndexLoaded?.();
		await pluginState.waitForExcludedSync?.();
	} catch {
		// ignore
	}
}

function isFileInFolder(folder: TFolder, file: TFile): boolean {
	const folderPath = String(folder.path ?? "").trim();
	if (!folderPath) return true;
	return file.path.startsWith(`${folderPath}/`);
}

function collectFolderFiles(pluginState: FileMenuPluginLike, folder: TFolder): TFile[] {
	const files = pluginState.app.vault?.getFiles?.() ?? [];
	return files.filter((entry) => {
		if (!(entry instanceof TFile)) return false;
		if (!isFileInFolder(folder, entry)) return false;
		if (pluginState.isExcludedPath?.(entry.path)) return false;
		return pluginState.indexer?.isFileKnown?.(entry.path) === true;
	});
}

async function applyFolderReviewState(pluginState: FileMenuPluginLike, files: TFile[], next: "draft" | "reviewed"): Promise<void> {
	await ensureReady(pluginState);
	const idxAny = pluginState.indexer;
	let changedAny = false;
	for (const file of files) {
		const path = String(file.path ?? "");
		if (!path) continue;
		let changed = false;
		try {
			const hidden = idxAny?.isFileHidden?.(path) === true;
			if (hidden) {
				changed = idxAny?.setFileReviewStateForAllRecords?.(path, next) === true;
			} else if (typeof idxAny?.setFileReviewStateForAllRecordsPreserveHidden === "function") {
				changed = idxAny.setFileReviewStateForAllRecordsPreserveHidden(path, next) === true;
			} else if (typeof idxAny?.setFileReviewStateForAllRecords === "function") {
				changed = idxAny.setFileReviewStateForAllRecords(path, next) === true;
			}
		} catch {
			changed = false;
		}
		if (changed) changedAny = true;
	}
	if (!changedAny) return;
	await persistAndRefresh(pluginState);
}

async function applyFolderHidden(pluginState: FileMenuPluginLike, files: TFile[], hidden: boolean): Promise<void> {
	await ensureReady(pluginState);
	const idxAny = pluginState.indexer;
	let changedAny = false;
	for (const file of files) {
		const path = String(file.path ?? "");
		if (!path) continue;
		let changed = false;
		try {
			changed = idxAny?.setFileHidden?.(path, hidden) === true;
		} catch {
			changed = false;
		}
		if (changed) changedAny = true;
	}
	if (!changedAny) return;
	await persistAndRefresh(pluginState);
}


export function registerFileMenu(plugin: EpochPlugin): void {
	const pluginState = plugin as FileMenuPluginLike;
	plugin.registerEvent(
		pluginState.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
			if (pluginState.indexReady !== true) return;
			const menuWithHide = menu as FileMenuHideable;

			if (file instanceof TFolder) {
				if (pluginState.isExcludedPath?.(file.path)) return;
				const folderFiles = collectFolderFiles(pluginState, file);
				const hasFolderFiles = folderFiles.length > 0;
				menu.addSeparator();
				menu.addItem((item: FileMenuItemLike) => {
					item
						.setTitle("Epochgram: Review")
						.setIcon("scan-eye")
						.setDisabled(!hasFolderFiles)
						.onClick(() => void Promise.resolve(applyFolderReviewState(pluginState, folderFiles, "reviewed")).finally(() => hideContextMenu(menuWithHide)));
				});
				menu.addItem((item: FileMenuItemLike) => {
					item
						.setTitle("Epochgram: Draft")
						.setIcon("pencil-ruler")
						.setDisabled(!hasFolderFiles)
						.onClick(() => void Promise.resolve(applyFolderReviewState(pluginState, folderFiles, "draft")).finally(() => hideContextMenu(menuWithHide)));
				});
				menu.addItem((item: FileMenuItemLike) => {
					item
						.setTitle("Epochgram: Hide")
						.setIcon("eye-off")
						.setDisabled(!hasFolderFiles)
						.onClick(() => void Promise.resolve(applyFolderHidden(pluginState, folderFiles, true)).finally(() => hideContextMenu(menuWithHide)));
				});
				return;
			}

			if (!(file instanceof TFile)) return;
			if (pluginState.isExcludedPath?.(file.path)) return;
			if (!pluginState.indexer?.isFileKnown?.(file.path)) return;

			menu.addSeparator();

			const pinned = pluginState.indexer.isFilePinned(file.path);
			menu.addItem((item) => {
				item
					.setTitle(pinned ? "Epochgram: Unpin" : "Epochgram: Pin")
					.setIcon(pinned ? "pin-off" : "pin")
					.onClick(async () => {
						await pluginState.toggleFilePin?.(file, !pinned);
					});
			});
			const currentMark: number | null = pluginState.indexer.getFileMarkColor(file.path);
			const explicitMark = normalizeMarkColorIndex(currentMark);
			const inheritedMark: number | null = (() => {
				if (explicitMark != null) return null;
				try {
					const map: unknown = pluginState.__epochInheritedMarkIndexByPath;
					if (!(map instanceof Map)) return null;
					return normalizeMarkColorIndex(map.get(file.path));
				} catch {
					return null;
				}
			})();
			menu.addItem((item: FileMenuItemLike) => {
				item.setTitle("Epochgram: Mark").setIcon("highlighter").setDisabled(false);

				const submenu = item.setSubmenu?.();
				if (!submenu) return;
				const rootEl: HTMLElement = pluginState.app.workspace?.containerEl ?? activeDocument.body;
				const groups = getEpochMarkColorGroups(rootEl);
				const colors = getEpochMarkColorSet(rootEl);
				const hasAnyMark = explicitMark != null || inheritedMark != null;
				const isDesktopPointer = (): boolean => {
					try {
						return !!window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
					} catch {
						return true;
					}
				};

				const nativeMenusEnabled = (() => {
					try {
						return !!pluginState.app.vault?.getConfig?.("nativeMenus");
					} catch {
						return false;
					}
				})();
				const useTextLabels = nativeMenusEnabled;
				const ICON_ONLY_LABEL = "\u00A0";
				const labelOrIconOnly = (label: string): string => (useTextLabels ? label : ICON_ONLY_LABEL);
				let activeGroupSubmenu: Menu | null = null;
				try {
					menuWithHide.onHide?.(() => {
						activeGroupSubmenu = null;
					});
				} catch { void 0; }
				submenu.addItem((it: FileMenuItemLike) => {
					it
						.setTitle(useTextLabels ? "Clear mark" : ICON_ONLY_LABEL)
						.setIcon("ban")
						.setDisabled(!hasAnyMark)
						.onClick(async () => {
							try {
								await applyMarkColorWithContext(plugin, {
									entryPath: file.path,
									nextColorIndex: null,
									currentColorIndex: explicitMark ?? inheritedMark
								});
							} finally {
								hideContextMenu(menuWithHide);
							}
						});
				});

				for (const group of groups) {
					submenu.addItem((it: FileMenuItemLike) => {
						it.setTitle(labelOrIconOnly(group.name)).setIcon("circle").setDisabled(false);
						try {
							const el = it.iconEl;
							if (el) {
								el.style.color = group.base.css;
								setCssStyles(el, { opacity: "1", filter: "none", webkitFilter: "none" });
							}
						} catch { void 0; }

						const groupSub = it.setSubmenu?.();
						if (!groupSub) return;
						try {
							const dom = it.dom;
							if (dom) {
								if (typeof dom.addClass === "function") dom.addClass("epoch-menu-no-arrow");
								else dom.classList?.add?.("epoch-menu-no-arrow");
							}
						} catch { void 0; }

						for (const shade of group.shades) {
							const idx = shade.index;
							const css = colors[idx - 1] || "";
							groupSub.addItem((subIt: FileMenuItemLike) => {
								subIt
									.setTitle(labelOrIconOnly(shade.name))
									.setIcon("circle")
									.setDisabled(false)
									.onClick(() => {
									void Promise.resolve(
										applyMarkColorWithContext(plugin, {
											entryPath: file.path,
											nextColorIndex: idx,
											currentColorIndex: explicitMark ?? inheritedMark
										})
									).finally(() => hideContextMenu(menuWithHide));
								});
								try {
										const el = subIt.iconEl;
									if (el) {
										el.style.color = css;
										setCssStyles(el, { opacity: "1", filter: "none", webkitFilter: "none" });
									}
								} catch { void 0; }
							});
						}

						try {
							const domAny = it.dom ?? null;
							const iconEl = it.iconEl ?? null;
							const domEl: HTMLElement | null = domAny && typeof domAny?.addEventListener === "function" ? domAny : null;
							const iconHTMLElement: HTMLElement | null = iconEl && typeof iconEl?.addEventListener === "function" ? iconEl : null;
							const targets = [domEl, iconHTMLElement].filter(Boolean) as HTMLElement[];
							const handler = (evt: Event) => {
								if (!isDesktopPointer()) return;
								try {
									evt.preventDefault?.();
									evt.stopPropagation?.();
								} catch { void 0; }
								void Promise.resolve(
									applyMarkColorWithContext(plugin, {
										entryPath: file.path,
										nextColorIndex: group.base.index,
										currentColorIndex: explicitMark ?? inheritedMark
									})
								).finally(() => hideContextMenu(menuWithHide));
							};
							for (const t of targets) {
								t.addEventListener?.("click", handler, { capture: true });
							}
						} catch { void 0; }

						try {
							const domAny = it.dom ?? null;
							const iconEl = it.iconEl ?? null;
							const domEl: HTMLElement | null = domAny && typeof domAny?.addEventListener === "function" ? domAny : null;
							const iconHTMLElement: HTMLElement | null = iconEl && typeof iconEl?.addEventListener === "function" ? iconEl : null;
							const anchor = domEl ?? iconHTMLElement;
							anchor?.addEventListener?.("mouseenter", () => {
								if (activeGroupSubmenu && activeGroupSubmenu !== groupSub) {
									try {
										activeGroupSubmenu.hide?.();
									} catch { void 0; }
								}
								activeGroupSubmenu = groupSub;
							});
							void domAny;
						} catch { void 0; }
					});
				}
			});

			{
				const idxAny = pluginState.indexer;
				const fileReviewMode: "draft" | "reviewed" | "hidden" = (() => {
					try {
						const files = pluginState.indexer?.toJSON?.()?.files ?? null;
						const data = files ? files[file.path] : null;
						const entries = gatherFileEntries(data);
						if (entries.length === 0) return "draft";
						const allHidden = entries.every((e) => e.reviewState === "hidden");
						if (allHidden) return "hidden";
						const nonHidden = entries.filter((e) => e.reviewState !== "hidden");
						if (nonHidden.length === 0) return "hidden";
						const allReviewed = nonHidden.every((e) => e.reviewState === "reviewed");
						return allReviewed ? "reviewed" : "draft";
					} catch {
						return "draft";
					}
				})();
				const applyReviewState = async (next: "draft" | "reviewed") => {
					await ensureReady(pluginState);
					let changed = false;
					try {
						if (fileReviewMode === "hidden") {
							changed = idxAny?.setFileReviewStateForAllRecords?.(file.path, next) === true;
						} else if (typeof idxAny?.setFileReviewStateForAllRecordsPreserveHidden === "function") {
							changed = idxAny.setFileReviewStateForAllRecordsPreserveHidden(file.path, next) === true;
						} else if (typeof idxAny?.setFileReviewStateForAllRecords === "function") {
							changed = idxAny.setFileReviewStateForAllRecords(file.path, next) === true;
						}
					} catch {
						changed = false;
					}
					if (!changed) return;
					await persistAndRefresh(pluginState);
				};

				if (fileReviewMode !== "draft") {
					menu.addItem((it: FileMenuItemLike) => {
						it
							.setTitle("Epochgram: Draft")
							.setIcon("pencil-ruler")
							.setDisabled(false)
							.onClick(() => void Promise.resolve(applyReviewState("draft")).finally(() => hideContextMenu(menuWithHide)));
					});
				}
				if (fileReviewMode !== "reviewed") {
					menu.addItem((it: FileMenuItemLike) => {
						it
							.setTitle("Epochgram: Review")
							.setIcon("scan-eye")
							.setDisabled(false)
							.onClick(() => void Promise.resolve(applyReviewState("reviewed")).finally(() => hideContextMenu(menuWithHide)));
					});
				}
			}

			{
				const idxAny = pluginState.indexer;
				const hidden = (() => {
					try {
						return typeof idxAny?.isFileHidden === "function" && idxAny.isFileHidden(file.path) === true;
					} catch {
						return false;
					}
				})();
				const apply = async () => {
					await ensureReady(pluginState);
					let changed = false;
					try {
						changed = idxAny?.setFileHidden?.(file.path, !hidden) === true;
					} catch {
						changed = false;
					}
					if (!changed) return;
					await persistAndRefresh(pluginState);
				};

				if (!hidden) {
					menu.addItem((it: FileMenuItemLike) => {
						it
							.setTitle("Epochgram: Hide")
							.setIcon("eye-off")
							.setDisabled(false)
							.onClick(() => void Promise.resolve(apply()).finally(() => hideContextMenu(menuWithHide)));
					});
				}
			}
		})
	);
}
