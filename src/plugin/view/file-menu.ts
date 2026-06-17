import type { TAbstractFile } from "obsidian";
import { Menu, TFile } from "obsidian";
import { applyMarkColorWithContext } from "../mark-context";
import { setCssStyles } from "../../dom";
import { gatherFileEntries } from "../../indexer/entry-state";
import {
	getEpochMarkColorGroups,
	getEpochMarkColorSet,
	normalizeMarkColorIndex
} from "../../ui/mark-colors";
import type { EpochPlugin } from "../../main";

const activeDocument = window.document;


export function registerFileMenu(plugin: EpochPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			if (!(plugin as any).indexReady) return;
			if ((plugin as any).isExcludedPath?.(file.path)) return;
			if (!(plugin as any).indexer?.isFileKnown?.(file.path)) return;

			menu.addSeparator();

			const pinned = (plugin as any).indexer.isFilePinned(file.path);
			menu.addItem((item) => {
				item
					.setTitle(pinned ? "Epochgram: Unpin" : "Epochgram: Pin")
					.setIcon(pinned ? "pin-off" : "pin")
					.onClick(async () => {
						await (plugin as any).toggleFilePin(file, !pinned);
					});
			});
			const currentMark: number | null = (plugin as any).indexer.getFileMarkColor(file.path);
			const explicitMark = normalizeMarkColorIndex(currentMark);
			const inheritedMark: number | null = (() => {
				if (explicitMark != null) return null;
				try {
					const map: unknown = (plugin as any)?.__epochInheritedMarkIndexByPath;
					if (!(map instanceof Map)) return null;
					return normalizeMarkColorIndex(map.get(file.path));
				} catch {
					return null;
				}
			})();
			menu.addItem((item) => {
				item.setTitle("Epochgram: Mark").setIcon("highlighter").setDisabled(false);

				const submenu = (item as any).setSubmenu?.();
				if (!submenu) return;
				const hideContextMenu = () => {
					try {
						(menu as any)?.hide?.();
					} catch { void 0; }
				};
				const rootEl: HTMLElement = (plugin as any).app.workspace?.containerEl ?? activeDocument.body;
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
						return !!(plugin.app as any)?.vault?.getConfig?.("nativeMenus");
					} catch {
						return false;
					}
				})();
				const useTextLabels = nativeMenusEnabled;
				const ICON_ONLY_LABEL = "\u00A0";
				const labelOrIconOnly = (label: string): string => (useTextLabels ? label : ICON_ONLY_LABEL);
				let activeGroupSubmenu: Menu | null = null;
				try {
					(menu as any)?.onHide?.(() => {
						activeGroupSubmenu = null;
					});
				} catch { void 0; }
				submenu.addItem((it: any) => {
					it
						.setTitle(useTextLabels ? "Clear mark" : ICON_ONLY_LABEL)
						.setIcon("ban")
						.setDisabled(!hasAnyMark)
						.onClick(async () => {
							try {
								await applyMarkColorWithContext(plugin as any, {
									entryPath: file.path,
									nextColorIndex: null,
									currentColorIndex: explicitMark ?? inheritedMark
								});
							} finally {
								hideContextMenu();
							}
						});
				});

				for (const group of groups) {
					submenu.addItem((it: any) => {
						it.setTitle(labelOrIconOnly(group.name)).setIcon("circle").setDisabled(false);
						try {
							const el = (it as any).iconEl as HTMLElement | undefined;
							if (el) {
								el.style.color = group.base.css;
								setCssStyles(el, { opacity: "1", filter: "none", webkitFilter: "none" });
							}
						} catch { void 0; }

						const groupSub = (it as any).setSubmenu?.();
						if (!groupSub) return;
						try {
							const dom: any = (it as any)?.dom;
							if (dom) {
								if (typeof dom.addClass === "function") dom.addClass("epoch-menu-no-arrow");
								else dom.classList?.add?.("epoch-menu-no-arrow");
							}
						} catch { void 0; }

						for (const shade of group.shades) {
							const idx = shade.index;
							const css = colors[idx - 1] || "";
							groupSub.addItem((subIt: any) => {
								subIt
									.setTitle(labelOrIconOnly(shade.name))
									.setIcon("circle")
									.setDisabled(false)
									.onClick(() => {
									void Promise.resolve(
										applyMarkColorWithContext(plugin as any, {
											entryPath: file.path,
											nextColorIndex: idx,
											currentColorIndex: explicitMark ?? inheritedMark
										})
									).finally(hideContextMenu);
								});
								try {
									const el = (subIt as any).iconEl as HTMLElement | undefined;
									if (el) {
										el.style.color = css;
										setCssStyles(el, { opacity: "1", filter: "none", webkitFilter: "none" });
									}
								} catch { void 0; }
							});
						}

						try {
							const domAny: any = (it as any)?.dom ?? null;
							const iconEl: any = (it as any)?.iconEl ?? null;
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
									applyMarkColorWithContext(plugin as any, {
										entryPath: file.path,
										nextColorIndex: group.base.index,
										currentColorIndex: explicitMark ?? inheritedMark
									})
								).finally(hideContextMenu);
							};
							for (const t of targets) {
								t.addEventListener?.("click", handler, { capture: true });
							}
						} catch { void 0; }

						try {
							const domAny: any = (it as any)?.dom ?? null;
							const iconEl: any = (it as any)?.iconEl ?? null;
							const domEl: HTMLElement | null = domAny && typeof domAny?.addEventListener === "function" ? domAny : null;
							const iconHTMLElement: HTMLElement | null = iconEl && typeof iconEl?.addEventListener === "function" ? iconEl : null;
							const anchor = (domEl ?? iconHTMLElement) as any;
							anchor?.addEventListener?.("mouseenter", () => {
								if (activeGroupSubmenu && activeGroupSubmenu !== groupSub) {
									try {
										(activeGroupSubmenu as any)?.hide?.();
									} catch { void 0; }
								}
								activeGroupSubmenu = groupSub;
							});
							if (!domEl && domAny && typeof domAny?.on === "function") {
								domAny.on("mouseenter", () => {
									if (activeGroupSubmenu && activeGroupSubmenu !== groupSub) {
										try {
											(activeGroupSubmenu as any)?.hide?.();
										} catch { void 0; }
									}
									activeGroupSubmenu = groupSub;
								});
							}
						} catch { void 0; }
					});
				}
			});

			{
				const idxAny: any = (plugin as any).indexer as any;
				const fileReviewMode: "draft" | "reviewed" | "hidden" = (() => {
					try {
						const files: any = (plugin as any).indexer?.toJSON?.()?.files ?? null;
						const data: any = files ? files[file.path] : null;
						const entries: any[] = gatherFileEntries(data);
						if (entries.length === 0) return "draft";
						const allHidden = entries.every((e) => (e as any)?.reviewState === "hidden");
						if (allHidden) return "hidden";
						const nonHidden = entries.filter((e) => (e as any)?.reviewState !== "hidden");
						if (nonHidden.length === 0) return "hidden";
						const allReviewed = nonHidden.every((e) => (e as any)?.reviewState === "reviewed");
						return allReviewed ? "reviewed" : "draft";
					} catch {
						return "draft";
					}
				})();
				const hideContextMenu = () => {
					try {
						(menu as any)?.hide?.();
					} catch { void 0; }
				};
				const applyReviewState = async (next: "draft" | "reviewed") => {
					try {
						await (plugin as any).ensureIndexLoaded?.();
						await (plugin as any).waitForExcludedSync?.();
					} catch {
						// ignore
					}
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
					try {
						if (typeof (plugin as any)?.persistIndex === "function") await (plugin as any).persistIndex({ skipEnsure: true });
					} catch {
						// ignore
					}
					try {
						(plugin as any)?.refreshEpochViews?.();
					} catch {
						// ignore
					}
				};

				if (fileReviewMode !== "draft") {
					menu.addItem((it: any) => {
						it
							.setTitle("Epochgram: Draft")
							.setIcon("pencil-ruler")
							.setDisabled(false)
							.onClick(() => void Promise.resolve(applyReviewState("draft")).finally(hideContextMenu));
					});
				}
				if (fileReviewMode !== "reviewed") {
					menu.addItem((it: any) => {
						it
							.setTitle("Epochgram: Review")
							.setIcon("scan-eye")
							.setDisabled(false)
							.onClick(() => void Promise.resolve(applyReviewState("reviewed")).finally(hideContextMenu));
					});
				}
			}

			{
				const idxAny: any = (plugin as any).indexer as any;
				const hidden = (() => {
					try {
						return typeof idxAny?.isFileHidden === "function" && idxAny.isFileHidden(file.path) === true;
					} catch {
						return false;
					}
				})();
				const hideContextMenu = () => {
					try {
						(menu as any)?.hide?.();
					} catch { void 0; }
				};
				const apply = async () => {
					try {
						await (plugin as any).ensureIndexLoaded?.();
						await (plugin as any).waitForExcludedSync?.();
					} catch {
						// ignore
					}
					let changed = false;
					try {
						changed = idxAny?.setFileHidden?.(file.path, !hidden) === true;
					} catch {
						changed = false;
					}
					if (!changed) return;
					try {
						if (typeof (plugin as any)?.persistIndex === "function") await (plugin as any).persistIndex({ skipEnsure: true });
					} catch {
						// ignore
					}
					try {
						(plugin as any)?.refreshEpochViews?.();
					} catch {
						// ignore
					}
				};

				menu.addItem((it: any) => {
					it
						.setTitle(hidden ? "Epochgram: Show" : "Epochgram: Hide")
						.setIcon(hidden ? "eye" : "eye-off")
						.setDisabled(false)
						.onClick(() => void Promise.resolve(apply()).finally(hideContextMenu));
				});
			}
		})
	);
}
