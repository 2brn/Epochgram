import { Menu } from "obsidian";
import type { EpochCanvas } from "../epoch-canvas";
import { createNoteForDate } from "../epoch-canvas-actions";
import {
	getDateForIndex,
	getToday,
 	getNextDailyNoteCreatePath
} from "../epoch-canvas-helpers";
import { getMenuState } from "./menu-state";
import { addMenuTitle, formatMenuTitleWithPath } from "./menu-title";

const activeDocument = (typeof window !== "undefined" ? window.document : ({} as Document)) as Document;

export function showDateMenu(
	canvas: EpochCanvas,
	dayIndex: number,
	clientX: number,
	clientY: number
): void {
	const state = getMenuState(canvas);
	const today = getToday();
	const date = getDateForIndex(dayIndex, today);
	const next = getNextDailyNoteCreatePath(canvas, date);
	const menu = new Menu();
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

	addMenuTitle(menu, formatMenuTitleWithPath(next.path), "file");
	menu.addSeparator();
	menu.addItem(item => {
		item
			.setTitle("Create daily note")
			.setIcon("file-plus")
			.setDisabled(false)
			.onClick(async () => {
				await createNoteForDate(canvas, date, true);
				state.clearHover(true);
			});
	});

	menu.showAtPosition({ x: clientX, y: clientY });

	// On mobile, tapping outside the menu can dismiss it without reliably triggering
	// Menu.onHide(). Clear hover/focus on the first outside tap.
	try {
		const onOutside = (ev: Event) => {
			const target = ev.target as any;
			const el: HTMLElement | null = target instanceof HTMLElement ? target : null;
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
}
