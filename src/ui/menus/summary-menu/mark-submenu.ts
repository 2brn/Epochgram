import { Menu } from "obsidian";
import type { DateEntry } from "../../../indexer/types";
import type { EpochCanvas } from "../../epoch-canvas";
import {
	getEpochMarkColorGroups,
	getEpochMarkColorSet,
	normalizeMarkColorIndex
} from "../../mark-colors";
import {
	getMarkCenterPathForGroupActions,
	resolveMarkAncestorPath,
	computeTargetsForMarkMenuAction,
	isPathInheritedMarked
} from "../../mark-group";
import { getMenuState } from "../menu-state";
import { getTopicGroupForPath } from "./topic-group";
import { setCssStyles } from "../../../dom";

const activeDocument = (typeof window !== "undefined" ? window.document : ({} as Document)) as Document;

export function addMarkSubmenu(
	menu: Menu,
	state: ReturnType<typeof getMenuState>,
	canvas: EpochCanvas,
	entry: DateEntry,
	indexer: any,
	currentMarkColor: unknown,
	inheritedSourcePath: string | null
): void {
	menu.addItem((item) => {
		const nativeMenusEnabled = (() => {
			try {
				const plugin: any = (state as any)?.plugin ?? null;
				return !!plugin?.app?.vault?.getConfig?.("nativeMenus");
			} catch {
				return false;
			}
		})();
		const useTextLabels = nativeMenusEnabled;
		const labelOrIconOnly = (label: string): string => (useTextLabels ? label : "\u00A0");

		const root = (canvas as any)?.root ?? activeDocument.body;
		const palette = getEpochMarkColorSet(root);
		const groups = getEpochMarkColorGroups(root);
		const current = normalizeMarkColorIndex(currentMarkColor);
		const explicit = (() => {
			try {
				return normalizeMarkColorIndex(indexer.getFileMarkColor(entry.file));
			} catch {
				return null;
			}
		})();
		item.setTitle("Mark");
		item.setIcon("highlighter");
		const submenu = (item as any).setSubmenu?.();
		if (!submenu) return;
		const hideContextMenu = () => {
			try {
				(menu as any)?.hide?.();
			} catch {
				// ignore
			}
		};

		let activeGroupSubmenu: Menu | null = null;
		try {
			(menu as any)?.onHide?.(() => {
				activeGroupSubmenu = null;
			});
		} catch {
			// ignore
		}

		const applyMarkColor = async (color: number | null) => {
			if (!indexer) return;
			let changed = false;
			const plugin = (state as any).plugin;

			try {
				const activeFilePath = (() => {
					try {
						const af = plugin?.app?.workspace?.getActiveFile?.();
						const p = typeof af?.path === "string" ? String(af.path || "") : "";
						if (!p || p.startsWith("epoch://")) return "";
						if (typeof plugin?.shouldIndexFile === "function" && af && !plugin.shouldIndexFile(af)) return "";
						if (typeof plugin?.indexer?.isFileKnown === "function" && !plugin.indexer.isFileKnown(p)) return "";
						return p;
					} catch {
						return "";
					}
				})();

				const fallbackCenter = getMarkCenterPathForGroupActions(indexer, entry.file, inheritedSourcePath);
				const resolvedAncestorPathFinal = await resolveMarkAncestorPath(
					plugin,
					indexer,
					fallbackCenter,
					inheritedSourcePath
				);

				const isActiveInherited = activeFilePath ? isPathInheritedMarked(plugin, indexer, activeFilePath) : false;
				const isEntryExplicit = explicit != null;
				const isEntryInherited =
					!isEntryExplicit && (!!inheritedSourcePath || isPathInheritedMarked(plugin, indexer, entry.file));
				const isEntrySimilarToActive = (() => {
					if (!activeFilePath) return false;
					if (entry.file === activeFilePath) return true;
					try {
						const set: unknown = (canvas as any)?.semanticRelatedPaths;
						return set instanceof Set ? set.has(entry.file) : false;
					} catch {
						return false;
					}
				})();

				const targets = computeTargetsForMarkMenuAction(plugin, {
					entryPath: entry.file,
					resolvedAncestorPath: resolvedAncestorPathFinal,
					isEntryInherited,
					isEntryExplicit,
					isEntrySimilarToActive,
					currentColorIndex: current,
					nextColorIndex: color,
					activeFilePath,
					isActiveFileInherited: isActiveInherited
				});
				const finalTargets = targets;

				// Touch topic-group helper so term store is loaded (helps the next inherited recompute)
				try {
					if (resolvedAncestorPathFinal) {
						await getTopicGroupForPath(state, resolvedAncestorPathFinal);
					}
				} catch {
					// ignore
				}

				try {
					for (const p of finalTargets) {
						if (!p || p.startsWith("epoch://")) continue;
						try {
							changed = !!indexer.setFileMarkColor(p, color) || changed;
						} catch {
							// ignore
						}
					}
				} catch {
					// ignore
				}
			} catch {
				// ignore
			}

			if (!changed) return;
			try {
				plugin.clearInheritedMarksCache?.();
			} catch {
				// ignore
			}
			try {
				// Recompute immediately so group + similar notes update in one visible step.
				await plugin.recomputeInheritedMarksNow?.("mark-change");
			} catch {
				try {
					plugin.scheduleInheritedMarkRecompute?.("mark-change");
				} catch {
					// ignore
				}
			}
			if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
			state.clearHover(true);
			state.refreshIndex();
		};

		const hasAny = !!current || explicit != null || inheritedSourcePath != null;
		const ICON_ONLY_LABEL = "\u00A0";
		const isDesktopPointer = (): boolean => {
			try {
				return !!window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
			} catch {
				return true;
			}
		};
		submenu.addItem((subItem: any) => {
			subItem
				.setTitle(useTextLabels ? "Clear mark" : ICON_ONLY_LABEL)
				.setIcon("ban")
				.setDisabled(!hasAny)
				.onClick(() => {
					void Promise.resolve(applyMarkColor(null)).finally(hideContextMenu);
				});
		});

		for (const group of groups) {
			submenu.addItem((groupItem: any) => {
				groupItem.setTitle(labelOrIconOnly(group.name)).setIcon("circle").setDisabled(false);
				try {
					const el: any = groupItem.iconEl;
					if (el) {
						el.style.color = group.base.css;
						setCssStyles(el, { opacity: "1", filter: "none", webkitFilter: "none" });
					}
				} catch {
					// ignore
				}

				const groupSub = (groupItem as any).setSubmenu?.();
				if (!groupSub) return;
				try {
					const dom: any = (groupItem as any)?.dom;
					if (dom) {
						if (typeof dom.addClass === "function") dom.addClass("epoch-menu-no-arrow");
						else dom.classList?.add?.("epoch-menu-no-arrow");
					}
				} catch {
					// ignore
				}

				for (const shade of group.shades) {
					const idx = shade.index;
					const css = palette[idx - 1] || "";
					groupSub.addItem((subItem: any) => {
						subItem
							.setTitle(labelOrIconOnly(shade.name))
							.setIcon("circle")
							.setDisabled(false)
							.onClick(() => {
								void Promise.resolve(applyMarkColor(idx)).finally(hideContextMenu);
							});
						try {
							const iconEl: any = subItem.iconEl;
							if (iconEl) {
								iconEl.style.color = css;
								setCssStyles(iconEl, { opacity: "1", filter: "none", webkitFilter: "none" });
							}
						} catch {
							// ignore
						}
					});
				}

				try {
					const domAny: any = (groupItem as any)?.dom ?? null;
					const iconEl: any = (groupItem as any)?.iconEl ?? null;
					const domEl: HTMLElement | null = domAny && typeof domAny?.addEventListener === "function" ? domAny : null;
					const iconHTMLElement: HTMLElement | null =
						iconEl && typeof iconEl?.addEventListener === "function" ? iconEl : null;
					const targets = [domEl, iconHTMLElement].filter(Boolean) as HTMLElement[];
					const handler = (evt: Event) => {
						if (!isDesktopPointer()) return;
						try {
							evt.preventDefault?.();
							evt.stopPropagation?.();
						} catch {
							// ignore
						}
						void Promise.resolve(applyMarkColor(group.base.index)).finally(hideContextMenu);
					};
					for (const t of targets) {
						t.addEventListener?.("click", handler, { capture: true });
					}
				} catch {
					// ignore
				}

				try {
					const domAny: any = (groupItem as any)?.dom ?? null;
					const iconEl: any = (groupItem as any)?.iconEl ?? null;
					const domEl: HTMLElement | null = domAny && typeof domAny?.addEventListener === "function" ? domAny : null;
					const iconHTMLElement: HTMLElement | null =
						iconEl && typeof iconEl?.addEventListener === "function" ? iconEl : null;
					const anchor = (domEl ?? iconHTMLElement) as any;
					anchor?.addEventListener?.("mouseenter", () => {
						if (activeGroupSubmenu && activeGroupSubmenu !== groupSub) {
							try {
								(activeGroupSubmenu as any)?.hide?.();
							} catch {
								// ignore
							}
						}
						activeGroupSubmenu = groupSub;
					});
					if (!domEl && domAny && typeof domAny?.on === "function") {
						domAny.on("mouseenter", () => {
							if (activeGroupSubmenu && activeGroupSubmenu !== groupSub) {
								try {
									(activeGroupSubmenu as any)?.hide?.();
								} catch {
									// ignore
								}
							}
							activeGroupSubmenu = groupSub;
						});
					}
				} catch {
					// ignore
				}
			});
		}
	});
}
