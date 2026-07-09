import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { epochViewOnOpen } from "../src/ui/epoch-view/lifecycle";

vi.mock("../src/ui/epoch-view/filter-ui", () => {
	return {
		createFilterToggle: vi.fn(({ container }: any) => {
			return container?.createDiv ? container.createDiv("mock-toggle") : {};
		}),
		createFilterButton: vi.fn(({ container }: any) => {
			return container?.createDiv ? container.createDiv("mock-button") : {};
		}),
		updateFilterPanelState: vi.fn(() => {})
	};
});

vi.mock("../src/ui/epoch-canvas", () => {
	class EpochCanvas {
		root: any;
		plugin: any;
		leaf: any;
		onAfterDraw: (() => void) | null = null;

		snapInitialPosition = vi.fn();
		initSize = vi.fn();
		setReviewFilterMode = vi.fn();
		setShowTrackedChanges = vi.fn();
		setShowContentDates = vi.fn();
		setShowPropDates = vi.fn();
		setShowAttachments = vi.fn();
		setEpochsView = vi.fn();
		setSearchQuery = vi.fn();
		refreshStyles = vi.fn();
		setActiveFile = vi.fn();

		constructor(root: any, plugin: any, leaf: any) {
			this.root = root;
			this.plugin = plugin;
			this.leaf = leaf;
		}
	}
	return { EpochCanvas };
});

class FakeEl {
	className: string;
	style: Record<string, any> = {};
	attrs = new Map<string, string>();
	tabIndex = 0;
	children: FakeEl[] = [];
	textContent = "";

	constructor(className: string = "") {
		this.className = className;
	}

	createDiv(className: string = ""): FakeEl {
		const child = new FakeEl(className);
		this.children.push(child);
		return child;
	}

	createSpan(className: string = ""): FakeEl {
		const child = new FakeEl(className);
		this.children.push(child);
		return child;
	}

	setAttribute(key: string, value: string): void {
		this.attrs.set(String(key), String(value));
	}
}

describe("epoch view non-md lifecycle", () => {
	it("forces focus updates for active non-md leaf changes", async () => {
		const prevRaf = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = vi.fn(() => 1);

		const imageFile = new TFile("photo.png", { extension: "png" });
		const listeners = new Map<string, Function>();
		const workspace: any = {
			activeLeaf: {
				view: {},
				getViewState: () => ({ state: { file: "photo.png" } })
			},
			on: vi.fn((name: string, cb: Function) => {
				listeners.set(name, cb);
				return { name, cb };
			}),
			getActiveViewOfType: vi.fn(() => null),
			getMostRecentLeaf: vi.fn(() => null),
			getLeavesOfType: vi.fn(() => [])
		};

		const view: any = {
			contentEl: new FakeEl("content"),
			container: null,
			rootEl: null,
			controlsEl: null,
			filtersPanelEl: null,
			plugin: {
				viewPreferences: {
					reviewFilterMode: "reviewed+draft",
					showAttachments: false,
					showTrackedChanges: true,
					parsedFilterMode: "parsed",
					showEpochsView: false
				},
				notifyProFeature: vi.fn(),
				hasProAccess: vi.fn(() => false)
			},
			leaf: {},
			activeFilePath: "note.md",
			app: {
				workspace,
				vault: {
					on: vi.fn(() => ({})),
					getAbstractFileByPath: vi.fn((p: string) => (p === "photo.png" ? imageFile : null))
				}
			},
			registerDomEvent: vi.fn(),
			registerEvent: vi.fn(),
			isPro: vi.fn(() => false),
			isEpochsEnabled: vi.fn(() => false),
			setFiltersExpanded: vi.fn(),
			updateFilterButtons: vi.fn(),
			scheduleSearchControlLayout: vi.fn(),
			scheduleSearchControlRefresh: vi.fn(),
			updateSearchControl: vi.fn(),
			openSearchModal: vi.fn(),
			refreshSyncedEpochAvailability: vi.fn(),
			updateProUiState: vi.fn(),
			updateActiveFile: vi.fn(),
			syncCanvasActiveFile: vi.fn(),
			startStartupDefaultNoteRefocus: vi.fn()
		};

		await epochViewOnOpen(view);

		const onLeafChange = listeners.get("active-leaf-change");
		expect(onLeafChange).toBeTypeOf("function");
		onLeafChange?.();

		expect(view.updateActiveFile).toHaveBeenCalledWith(undefined, { suppressFocus: false });

		(globalThis as any).requestAnimationFrame = prevRaf;
	});

	it("snaps startup to active non-md file from leaf state", async () => {
		const prevRaf = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});

		const imageFile = new TFile("photo.png", { extension: "png" });
		const workspace: any = {
			activeLeaf: {
				view: {},
				getViewState: () => ({ state: { file: "photo.png" } })
			},
			on: vi.fn(() => ({})),
			getActiveViewOfType: vi.fn(() => null),
			getMostRecentLeaf: vi.fn(() => null),
			getLeavesOfType: vi.fn(() => [])
		};

		const view: any = {
			contentEl: new FakeEl("content"),
			container: null,
			rootEl: null,
			controlsEl: null,
			filtersPanelEl: null,
			plugin: {
				viewPreferences: {
					reviewFilterMode: "reviewed+draft",
					showAttachments: false,
					showTrackedChanges: true,
					parsedFilterMode: "parsed",
					showEpochsView: false
				},
				notifyProFeature: vi.fn(),
				hasProAccess: vi.fn(() => false)
			},
			leaf: {},
			app: {
				workspace,
				vault: {
					on: vi.fn(() => ({})),
					getAbstractFileByPath: vi.fn((p: string) => (p === "photo.png" ? imageFile : null))
				}
			},
			registerDomEvent: vi.fn(),
			registerEvent: vi.fn(),
			isPro: vi.fn(() => false),
			isEpochsEnabled: vi.fn(() => false),
			setFiltersExpanded: vi.fn(),
			updateFilterButtons: vi.fn(),
			scheduleSearchControlLayout: vi.fn(),
			scheduleSearchControlRefresh: vi.fn(),
			updateSearchControl: vi.fn(),
			openSearchModal: vi.fn(),
			refreshSyncedEpochAvailability: vi.fn(),
			updateProUiState: vi.fn(),
			updateActiveFile: vi.fn(),
			syncCanvasActiveFile: vi.fn(),
			startStartupDefaultNoteRefocus: vi.fn()
		};

		await epochViewOnOpen(view);

		expect(view.canvas.snapInitialPosition).toHaveBeenCalledWith("photo.png", null, { draw: false });
		expect(view.canvas.snapInitialPosition).toHaveBeenCalledTimes(1);

		(globalThis as any).requestAnimationFrame = prevRaf;
	});
});
