import { Menu, normalizePath } from "obsidian";
import type { DateEntry, ReviewState } from "../../indexer/types";
import type { EpochCanvas } from "../epoch-canvas";
import { getEntryTitle } from "../epoch-canvas-helpers";
import { normalizeMarkColorIndex } from "../mark-colors";
import { getMenuState } from "./menu-state";
import { formatMenuTitleWithPath } from "./menu-title";
import { addMarkSubmenu } from "./summary-menu/mark-submenu";
import { addEpochMenuIfApplicable } from "./summary-menu/epoch-menu";
import {
	addDelete,
	addEditSummary,
	addFileRenameMove,
	addOpenFile,
	addPinToggle,
	addReviewSubmenu
} from "./summary-menu/entry-actions";
import { addEditTopic } from "./summary-menu/topic-menu";

type MenuDomLike = HTMLElement & { addClass?: (name: string) => void };
type MenuWithDom = Menu & { dom?: MenuDomLike; containerEl?: MenuDomLike };
type CanvasMarksLike = EpochCanvas & { inheritedMarkSourceByPath?: Map<string, string> };

const activeDocument: Document = typeof window !== "undefined" ? window.document : ({} as Document);

export function showSummaryMenu(canvas: EpochCanvas, entry: DateEntry, clientX: number, clientY: number): Menu {
	const state = getMenuState(canvas);
	const menu = new Menu();
	const addMenuClass = (className: string) => {
		try {
			const typedMenu = menu as MenuWithDom;
			const dom = typedMenu.dom ?? typedMenu.containerEl;
			if (!dom) return;
			if (typeof dom.addClass === "function") dom.addClass(className);
			else dom.classList?.add?.(className);
		} catch {
			// ignore
		}
	};
	let removeOutsideListener: (() => void) | null = null;
	menu.onHide(() => {
		if (removeOutsideListener) {
			try {
				removeOutsideListener();
			} catch { void 0; }
			removeOutsideListener = null;
		}

		state.keepHoverAfterMenu = false;
		state.clearHover(true);
	});

	if (addEpochMenuIfApplicable(menu, state, canvas, entry)) {
		menu.showAtPosition({ x: clientX, y: clientY });
		return menu;
	}

	addMenuClass("epoch-menu-record");

	const plugin = state.plugin;
	const indexer = plugin?.indexer;
	const entryPath = normalizePath(String(entry.file || ""));
	const reviewState: ReviewState =
		entry.reviewState === "hidden"
			? "hidden"
			: (entry.reviewState === "reviewed" ? "reviewed" : "draft");
	const explicitMarkColor: number | null = (() => {
		try {
			const color = indexer?.getFileMarkColor(entryPath);
			return typeof color === "number" ? color : null;
		} catch {
			return null;
		}
	})();
	const inheritedMarkColor = (() => {
		try {
			const map: unknown = plugin?.__epochInheritedMarkIndexByPath;
			if (!(map instanceof Map)) return null;
			return normalizeMarkColorIndex(map.get(entryPath));
		} catch {
			return null;
		}
	})();
	const markColor = normalizeMarkColorIndex(explicitMarkColor) ?? inheritedMarkColor;
	const pinned = plugin?.indexer?.isFilePinned?.(entryPath) === true;
	const title = getEntryTitle(canvas, entry) || entry.file || "(unknown file)";
	const menuTitle = formatMenuTitleWithPath(entryPath) || title;
	const inheritedSourcePath = (() => {
		try {
			const map = (canvas as CanvasMarksLike).inheritedMarkSourceByPath;
			if (!(map instanceof Map)) return null;
			const v = map.get(entryPath);
			return typeof v === "string" && v ? v : null;
		} catch {
			return null;
		}
	})();

	addOpenFile(menu, canvas, entry, menuTitle);
	addEditSummary(menu, state, entry, title);
	// addSummarizeAi(menu, state, entry);
	addEditTopic(menu, state, entry, title);
	menu.addSeparator();
	addPinToggle(menu, state, entry, pinned);
	addMarkSubmenu(menu, state, canvas, entry, indexer, markColor, inheritedSourcePath);
	addReviewSubmenu(menu, state, entry, reviewState);
	menu.addSeparator();
	addFileRenameMove(menu, state, canvas, entry);
	addDelete(menu, state, canvas, entry);
	menu.showAtPosition({ x: clientX, y: clientY });

	// On mobile, tapping outside the menu can dismiss it without reliably triggering
	// Menu.onHide(). Clear hover/focus on the first outside tap.
	try {
		const toElement = (value: EventTarget | null): Element | null => {
			return value instanceof Element ? value : null;
		};
		const onOutside = (ev: Event) => {
			const el = toElement(ev.target);
			if (el && el.closest(".menu")) return;
			state.keepHoverAfterMenu = false;
			state.clearHover(true);
			if (removeOutsideListener) {
				removeOutsideListener();
				removeOutsideListener = null;
			}
		};
		removeOutsideListener = () => {
			activeDocument.removeEventListener("pointerdown", onOutside, true);
			activeDocument.removeEventListener("touchstart", onOutside, true);
		};
		activeDocument.addEventListener("pointerdown", onOutside, true);
		activeDocument.addEventListener("touchstart", onOutside, true);
	} catch {
		// ignore
	}

	return menu;
}

