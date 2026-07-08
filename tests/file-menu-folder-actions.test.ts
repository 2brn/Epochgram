import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/plugin/mark-context", () => ({
	applyMarkColorWithContext: vi.fn()
}));

vi.mock("../src/dom", () => ({
	setCssStyles: vi.fn()
}));

vi.mock("../src/indexer/entry-state", () => ({
	gatherFileEntries: (data: any) => Array.isArray(data?.entries) ? data.entries : []
}));

vi.mock("../src/ui/mark-colors", () => ({
	getEpochMarkColorGroups: () => [],
	getEpochMarkColorSet: () => [],
	normalizeMarkColorIndex: (value: unknown) => typeof value === "number" ? value : null
}));

vi.mock("obsidian", () => {
	class TAbstractFile {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	}

	class TFile extends TAbstractFile {}
	class TFolder extends TAbstractFile {}

	class Menu {
		items: Array<{ title: string; icon: string; disabled: boolean; onClick?: () => void | Promise<void> }> = [];
		separators = 0;

		addSeparator() {
			this.separators += 1;
		}

		addItem(callback: (item: any) => void) {
			const record = { title: "", icon: "", disabled: false, onClick: undefined as (() => void | Promise<void>) | undefined };
			const item = {
				setTitle(title: string) {
					record.title = title;
					return item;
				},
				setIcon(icon: string) {
					record.icon = icon;
					return item;
				},
				setDisabled(disabled: boolean) {
					record.disabled = disabled;
					return item;
				},
				onClick(handler: () => void | Promise<void>) {
					record.onClick = handler;
					return item;
				},
				setSubmenu() {
					return new Menu();
				},
				dom: null,
				iconEl: null
			};
			callback(item);
			this.items.push(record);
		}

		hide() {}
		onHide() {}
	}

	return { Menu, TAbstractFile, TFile, TFolder };
});

import { Menu, TFile, TFolder } from "obsidian";
import { registerFileMenu } from "../src/plugin/view/file-menu";

describe("registerFileMenu", () => {
	let fileMenuHandler: ((menu: any, file: any) => void) | null;

	beforeEach(() => {
		fileMenuHandler = null;
	});

	function setupPlugin() {
		const plugin: any = {
			indexReady: true,
			registerEvent: vi.fn(),
			app: {
				workspace: {
					containerEl: {} as HTMLElement,
					on: vi.fn((_eventName: string, callback: (menu: any, file: any) => void) => {
						fileMenuHandler = callback;
						return {};
					})
				},
				vault: {
					getFiles: () => [new TFile("folder/a.md"), new TFile("folder/b.md")]
				}
			},
			indexer: {
				isFileKnown: () => true,
				isFilePinned: () => false,
				getFileMarkColor: () => null,
				setFileReviewStateForAllRecords: vi.fn(() => true),
				setFileReviewStateForAllRecordsPreserveHidden: vi.fn(() => true),
				isFileHidden: (path: string) => path === "hidden.md",
				setFileHidden: vi.fn(() => true),
				toJSON: () => ({
					files: {
						"hidden.md": { entries: [{ reviewState: "hidden" }] }
					}
				})
			},
			isExcludedPath: () => false,
			ensureIndexLoaded: vi.fn(),
			waitForExcludedSync: vi.fn(),
			persistIndex: vi.fn(),
			refreshEpochViews: vi.fn()
		};

		registerFileMenu(plugin);
		return plugin;
	}

	it("adds Review, Draft, and Hide to folder menus", () => {
		setupPlugin();
		const menu: any = new Menu();
		fileMenuHandler?.(menu, new TFolder("folder"));

		expect(menu.items.map((item: any) => item.title)).toEqual([
			"Epochgram: Review",
			"Epochgram: Draft",
			"Epochgram: Hide"
		]);
	});

	it("does not add the obsolete Show action for hidden files", () => {
		setupPlugin();
		const menu: any = new Menu();
		fileMenuHandler?.(menu, new TFile("hidden.md"));

		expect(menu.items.map((item: any) => item.title)).not.toContain("Epochgram: Show");
	});

	it("uses record-level review state from index dates for file menu actions", () => {
		const plugin = setupPlugin();
		plugin.indexer.toJSON = () => ({
			files: {
				"recurring.md": { entries: [{ reviewState: "draft" }] }
			},
			dates: {
				"2026-07-08": [{ file: "recurring.md", reviewState: "reviewed", recurring: true }]
			}
		});

		const menu: any = new Menu();
		fileMenuHandler?.(menu, new TFile("recurring.md"));

		const titles = menu.items.map((item: any) => item.title);
		expect(titles).toContain("Epochgram: Draft");
		expect(titles).not.toContain("Epochgram: Review");
	});
});