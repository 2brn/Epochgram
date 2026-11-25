import { Menu, TFile, TFolder } from "obsidian";
import type { EpochPlugin } from "../../main";
import { applyMarkColorWithContext } from "../mark-context";
import { getEpochMarkColorGroups, getEpochMarkColorSet, normalizeMarkColorIndex } from "../../ui/mark-colors";
import { setCssStyles } from "../../dom";
type MenuItem = { setTitle(title: string): MenuItem; setIcon(icon: string): MenuItem; setDisabled(disabled: boolean): MenuItem; onClick(callback: () => void | Promise<void>): MenuItem; setSubmenu?(): Menu; iconEl?: HTMLElement; dom?: HTMLElement };
export function registerFileMenu(plugin: EpochPlugin): void {
	plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
		if (!plugin.indexReady) return;
		const paths = file instanceof TFolder
			? plugin.indexer.getIndexedPaths().filter(path => !file.path || file.path === "/" || path.startsWith(`${file.path}/`))
			: file instanceof TFile && plugin.shouldIndexFile(file) && plugin.indexer.isFileKnown(file.path) ? [file.path] : [];
		if (!paths.length) return;
		menu.addSeparator();
		menu.addItem(item => item.setTitle("Epochgram: Review").setIcon("eye").onClick(() => plugin.setPathsReview(paths, "reviewed", true)));
		menu.addItem(item => item.setTitle("Epochgram: Draft").setIcon("pencil-ruler").onClick(() => plugin.setPathsReview(paths, "draft", true)));
		const hidden = paths.every(path => plugin.indexer.getFileReviewState(path) === "hidden");
		menu.addItem(item => item.setTitle(hidden ? "Epochgram: Unhide" : "Epochgram: Hide").setIcon(hidden ? "eye" : "eye-off").onClick(() => plugin.setPathsReview(paths, hidden ? "draft" : "hidden")));
		if (!(file instanceof TFile)) return;
		menu.addSeparator();
		const pinned = plugin.indexer.isFilePinned(file.path);
		menu.addItem(item => item.setTitle(pinned ? "Epochgram: Unpin" : "Epochgram: Pin").setIcon(pinned ? "pin-off" : "pin").onClick(() => plugin.toggleFilePin(file, !pinned)));
		const explicit = normalizeMarkColorIndex(plugin.indexer.getFileMarkColor(file.path));
		const explicitHex = (() => { try { return String(plugin.indexer.getFileMarkHex?.(file.path) ?? "").trim(); } catch { return ""; } })();
		const inherited = explicit != null || explicitHex ? null : normalizeMarkColorIndex(plugin.__epochInheritedMarkIndexByPath?.get(file.path));
		const current = explicit ?? inherited;
		const useLabels = (() => {
			try { return !!(plugin.app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.("nativeMenus"); }
			catch { return false; }
		})();
		const labelOrIconOnly = (label: string): string => useLabels ? label : "\u00A0";
		const apply = async (color: number | null) => {
			try { await applyMarkColorWithContext(plugin, { entryPath: file.path, nextColorIndex: color, currentColorIndex: current }); }
			finally { try { menu.hide(); } catch { /* A menu may already be detached. */ } }
		};
		menu.addItem(raw => {
			const item = raw as unknown as MenuItem;
			item.setTitle("Epochgram: Mark").setIcon("highlighter");
			const submenu = item.setSubmenu?.(); if (!submenu) return;
			const root = plugin.app.workspace.containerEl ?? window.document.body;
			const colors = getEpochMarkColorSet(root);
			const isDesktopPointer = () => {
				try { return !!window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches; }
				catch { return true; }
			};
			let activeGroupSubmenu: Menu | null = null;
			(menu as Menu & { onHide?: (callback: () => void) => void }).onHide?.(() => { activeGroupSubmenu = null; });
			submenu.addItem(clear => clear.setTitle(labelOrIconOnly("Clear mark")).setIcon("ban").setDisabled(current == null && !explicitHex).onClick(() => apply(null)));
			for (const group of getEpochMarkColorGroups(root)) submenu.addItem(rawGroup => {
				const groupItem = rawGroup as unknown as MenuItem;
				groupItem.setTitle(labelOrIconOnly(group.name)).setIcon("circle");
				if (groupItem.iconEl) {
					groupItem.iconEl.style.color = group.base.css;
					setCssStyles(groupItem.iconEl, { opacity: "1", filter: "none", webkitFilter: "none" });
				}
				const shades = groupItem.setSubmenu?.(); if (!shades) return;
				groupItem.dom?.classList?.add("epoch-menu-no-arrow");
				for (const shade of group.shades) shades.addItem(rawShade => {
					const shadeItem = rawShade as unknown as MenuItem;
					shadeItem.setTitle(labelOrIconOnly(shade.name)).setIcon("circle").onClick(() => apply(shade.index));
					if (shadeItem.iconEl) {
						shadeItem.iconEl.style.color = colors[shade.index - 1] || "";
						setCssStyles(shadeItem.iconEl, { opacity: "1", filter: "none", webkitFilter: "none" });
					}
				});
				const targets = [groupItem.dom, groupItem.iconEl].filter((el): el is HTMLElement => !!el?.addEventListener);
				for (const target of targets) target.addEventListener("click", event => {
					if (!isDesktopPointer()) return;
					event.preventDefault(); event.stopPropagation(); void apply(group.base.index);
				}, { capture: true });
				targets[0]?.addEventListener("mouseenter", () => {
					if (activeGroupSubmenu && activeGroupSubmenu !== shades) {
						try { activeGroupSubmenu.hide(); } catch { /* Already detached. */ }
					}
					activeGroupSubmenu = shades;
				});
			});
		});
	}));
}
