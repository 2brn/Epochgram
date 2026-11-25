import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

vi.mock("../src/plugin/mark-context", () => ({ applyMarkColorWithContext: vi.fn(async () => {}) }));
vi.mock("../src/ui/mark-colors", async () => ({
	...(await vi.importActual("../src/ui/mark-colors")),
	getEpochMarkColorSet: () => ["#c14d58", "#8b6cef"],
	getEpochMarkColorGroups: () => [
		{ name: "Red", base: { index: 1, css: "#c14d58" }, shades: [{ name: "Red shade", index: 1, css: "#c14d58" }] },
		{ name: "Purple", base: { index: 2, css: "#8b6cef" }, shades: [{ name: "Purple shade", index: 2, css: "#8b6cef" }] }
	]
}));
import { registerFileMenu } from "../src/plugin/view/file-menu";
import { addMarkSubmenu } from "../src/ui/menus/summary-menu/mark-submenu";
import { applyMarkColorWithContext } from "../src/plugin/mark-context";

function element(): any {
	const handlers = new Map<string, (event: any) => void>();
	return { style: {}, classList: { add: vi.fn() }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
		dispatch(name: string) { const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }; handlers.get(name)?.(event); return event; } };
}
function makeMenu(): any {
	return {
		items: [], hide: vi.fn(), onHide: vi.fn(), addSeparator() {},
		addItem(callback: (item: any) => void) {
			const item: any = {
				dom: element(), iconEl: element(),
				setTitle(title: string) { this.title = title; return this; },
				setIcon(icon: string) { this.icon = icon; return this; },
				setDisabled(disabled: boolean) { this.disabled = disabled; return this; },
				onClick(click: () => void) { this.click = click; return this; },
				setSubmenu() { return this.submenu ??= makeMenu(); }
			};
			callback(item); this.items.push(item);
		}
	};
}
function descendants(menu: any): any[] {
	return menu.items.flatMap((item: any) => [{ title: item.title, icon: item.icon }, ...(item.submenu ? descendants(item.submenu) : [])]);
}

function filePalette(options: { hex?: string; inherited?: number; throwHex?: boolean } = {}): any {
	let handler: any;
	const plugin: any = {
		app: { vault: {}, workspace: { containerEl: {}, on: (_name: string, fn: any) => { handler = fn; } } },
		indexReady: true, shouldIndexFile: () => true, registerEvent() {},
		__epochInheritedMarkIndexByPath: new Map([["note.md", options.inherited]]),
		indexer: { isFileKnown: () => true, getFileReviewState: () => "draft", isFilePinned: () => false, getFileMarkColor: () => null,
			getFileMarkHex: () => { if (options.throwHex) throw new Error("unavailable"); return options.hex ?? ""; } }
	};
	registerFileMenu(plugin);
	const menu = makeMenu(); handler(menu, new TFile("note.md"));
	return { plugin, menu, palette: menu.items.find((item: any) => item.title === "Epochgram: Mark").submenu };
}

describe("file-menu interaction parity", () => {
	it("closes the previous group's submenu when hovering a sibling, and resets on menu close", () => {
		const { menu, palette } = filePalette();
		const red = palette.items[1], orange = palette.items[2];
		red.dom.dispatch("mouseenter"); red.dom.dispatch("mouseenter");
		expect(red.submenu.hide).not.toHaveBeenCalled();
		orange.dom.dispatch("mouseenter"); expect(red.submenu.hide).toHaveBeenCalledOnce();
		red.dom.dispatch("mouseenter"); expect(orange.submenu.hide).toHaveBeenCalledOnce();
		menu.onHide.mock.calls[0][0]();
		orange.dom.dispatch("mouseenter"); expect(red.submenu.hide).toHaveBeenCalledOnce();
	});
	it("restores icon styling and hides redundant group arrows", () => {
		const { palette } = filePalette();
		const group = palette.items[1];
		expect(group.dom.classList.add).toHaveBeenCalledWith("epoch-menu-no-arrow");
		for (const item of [group, group.submenu.items[0]]) expect(item.iconEl.style).toMatchObject({ color: "#c14d58", opacity: "1", filter: "none", webkitFilter: "none" });
	});
	it.each(["desktop", "touch", "missing", "throws"])("handles base-color icon clicks with %s pointer capability", async mode => {
		const previous = window.matchMedia;
		(window as any).matchMedia = mode === "missing" ? undefined : () => { if (mode === "throws") throw new Error("unavailable"); return { matches: mode === "desktop" }; };
		try {
			vi.mocked(applyMarkColorWithContext).mockClear();
			const { palette, menu } = filePalette();
			const event = palette.items[1].iconEl.dispatch("click");
			await Promise.resolve(); await Promise.resolve();
			if (mode === "desktop" || mode === "throws") {
				expect(applyMarkColorWithContext).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(menu.hide).toHaveBeenCalledOnce();
			} else expect(applyMarkColorWithContext).not.toHaveBeenCalled();
		} finally { window.matchMedia = previous; }
	});
	it("does not use a stale inherited color for an explicit hex mark", async () => {
		const { plugin, palette } = filePalette({ hex: "#123456", inherited: 2 });
		expect(palette.items[0].disabled).toBe(false);
		await palette.items[1].submenu.items[0].click();
		expect(applyMarkColorWithContext).toHaveBeenLastCalledWith(plugin, { entryPath: "note.md", nextColorIndex: 1, currentColorIndex: null });
	});
	it("keeps the palette available if optional hex lookup throws", () => { expect(() => filePalette({ throwHex: true })).not.toThrow(); });
});

describe("file-menu mark labels match record-menu labels", () => {
	it.each(["native", "custom", "missing", "throws"])("uses identical palette labels for %s menus", async mode => {
		const vault = mode === "missing" ? {} : { getConfig: vi.fn((key: string) => {
			expect(key).toBe("nativeMenus");
			if (mode === "throws") throw new Error("Config unavailable");
			return mode === "native";
		}) };
		const root = {}, file = new TFile("note.md");
		let handler!: (menu: any, file: TFile) => void;
		const indexer = {
			isFileKnown: () => true, getFileReviewState: () => "draft", isFilePinned: () => false,
			getFileMarkColor: () => null, getFileMarkHex: () => "", setFileMarkColor: vi.fn()
		};
		const plugin: any = {
			app: { vault, workspace: { containerEl: root, on: (_name: string, cb: typeof handler) => { handler = cb; } } },
			indexReady: true, shouldIndexFile: () => true, registerEvent: vi.fn(), indexer
		};
		registerFileMenu(plugin);
		const fileMenu = makeMenu(); handler(fileMenu, file);
		const fileMark = fileMenu.items.find((item: any) => item.title === "Epochgram: Mark");
		const recordMenu = makeMenu();
		addMarkSubmenu(recordMenu, { plugin } as any, { root } as any, { file: file.path } as any, indexer, null, null);
		const recordMark = recordMenu.items[0];
		expect(recordMark.title).toBe("Mark");
		expect(descendants(fileMark.submenu)).toEqual(descendants(recordMark.submenu));
		expect(descendants(fileMark.submenu).map(item => item.title)).toEqual(mode === "native"
			? ["Clear mark", "Red", "Red shade", "Purple", "Purple shade"]
			: Array(5).fill("\u00A0"));
		expect(fileMark.submenu.items[0].disabled).toBe(true);
		await fileMark.submenu.items[1].submenu.items[0].click();
		expect(applyMarkColorWithContext).toHaveBeenLastCalledWith(plugin, { entryPath: "note.md", nextColorIndex: 1, currentColorIndex: null });
		expect(fileMenu.hide).toHaveBeenCalledOnce();
	});
});
