import { Menu } from "obsidian";

type MenuTitleItemLike = {
	setTitle(title: string): MenuTitleItemLike;
	setIcon(icon: string | null): MenuTitleItemLike;
	setIsLabel(value: boolean): MenuTitleItemLike;
	setDisabled(value: boolean): MenuTitleItemLike;
	dom?: HTMLElement & { addClass?: (name: string) => void };
};

export function formatMenuTitleWithPath(filePath: string): string {
	const raw = String(filePath || "").trim();
	if (!raw) return "";
	return raw
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\//, "");
}

export function addMenuTitle(menu: Menu, title: string, icon?: string | null): void {
	menu.addItem((item: MenuTitleItemLike) => {
		item.setTitle(title).setIcon(icon ?? null).setIsLabel(true).setDisabled(true);
		try {
			const dom = item.dom;
			if (dom) {
				if (typeof dom.addClass === "function") dom.addClass("epoch-menu-filename");
				else dom.classList?.add?.("epoch-menu-filename");
			}
		} catch {
			// ignore
		}
	});
}
