import { Menu } from "obsidian";

export function formatMenuTitleWithPath(filePath: string): string {
	const raw = String(filePath || "").trim();
	if (!raw) return "";
	return raw
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\//, "");
}

export function addMenuTitle(menu: Menu, title: string, icon?: string | null): void {
	menu.addItem((item) => {
		item.setTitle(title).setIcon(icon ?? null).setIsLabel(true).setDisabled(true);
		try {
			const dom: any = (item as any)?.dom;
			if (dom) {
				if (typeof dom.addClass === "function") dom.addClass("epoch-menu-filename");
				else dom.classList?.add?.("epoch-menu-filename");
			}
		} catch {
			// ignore
		}
	});
}
