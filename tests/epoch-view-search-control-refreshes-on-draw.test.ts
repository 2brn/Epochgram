import { describe, expect, it, vi } from "vitest";

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

describe("epoch view search control refresh", () => {
	it("refreshes the search label after draw even when query is empty", async () => {
		const prevRaf = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = vi.fn(() => 1);

		let resizeCb: (() => void) | null = null;
		const prevResizeObserver = (globalThis as any).ResizeObserver;
		(globalThis as any).ResizeObserver = class ResizeObserver {
			cb: () => void;
			constructor(cb: () => void) {
				this.cb = cb;
				resizeCb = cb;
			}
			observe(): void {
				// no-op
			}
			disconnect(): void {
				// no-op
			}
		};

		const scheduleSearchControlRefresh = vi.fn();
		const scheduleSearchControlLayout = vi.fn();

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
					showEpochsView: true
				},
				notifyProFeature: vi.fn(),
				hasProAccess: vi.fn(() => false)
			},
			leaf: {},
			app: {
				workspace: {
					on: vi.fn(() => ({})),
					getActiveViewOfType: vi.fn(() => null),
					getMostRecentLeaf: vi.fn(() => null)
				},
				vault: {
					on: vi.fn(() => ({}))
				}
			},
			registerDomEvent: vi.fn(),
			registerEvent: vi.fn(),
			isPro: vi.fn(() => false),
			isEpochsEnabled: vi.fn(() => true),
			setFiltersExpanded: vi.fn(),
			updateFilterButtons: vi.fn(),
			scheduleSearchControlLayout,
			scheduleSearchControlRefresh,
			updateSearchControl: vi.fn(),
			openSearchModal: vi.fn(),
			refreshSyncedEpochAvailability: vi.fn(),
			updateProUiState: vi.fn(),
			updateActiveFile: vi.fn(),
			syncCanvasActiveFile: vi.fn()
		};

		await epochViewOnOpen(view);

		scheduleSearchControlRefresh.mockClear();

		expect(typeof view.canvas?.onAfterDraw).toBe("function");
		view.canvas.onAfterDraw();
		expect(scheduleSearchControlRefresh).toHaveBeenCalledTimes(1);

		scheduleSearchControlRefresh.mockClear();
		expect(typeof resizeCb).toBe("function");
		resizeCb?.();
		expect(scheduleSearchControlRefresh).toHaveBeenCalledTimes(1);
		expect(scheduleSearchControlLayout).toHaveBeenCalled();

		(globalThis as any).requestAnimationFrame = prevRaf;
		(globalThis as any).ResizeObserver = prevResizeObserver;
	});
});
