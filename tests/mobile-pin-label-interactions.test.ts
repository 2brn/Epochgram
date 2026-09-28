import { describe, expect, it, vi, afterEach } from "vitest";
import { Platform, TFile, WorkspaceLeaf } from "obsidian";
import { updatePinOverlay } from "../src/ui/epoch-pin-overlay";

class FakeClassList {
	private readonly values = new Set<string>();

	add(...names: string[]): void {
		for (const name of names) this.values.add(name);
	}

	remove(...names: string[]): void {
		for (const name of names) this.values.delete(name);
	}

	toggle(name: string, force?: boolean): boolean {
		const enabled = force ?? !this.values.has(name);
		if (enabled) this.values.add(name);
		else this.values.delete(name);
		return enabled;
	}

	contains(name: string): boolean {
		return this.values.has(name);
	}
}

class FakeDocument {
	readonly defaultView = { getComputedStyle: () => ({ getPropertyValue: () => "" }) };
	readonly listeners = new Map<string, Array<(event: any) => void>>();

	addEventListener(name: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	}

	removeEventListener(name: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(name) ?? [];
		this.listeners.set(name, listeners.filter((current) => current !== listener));
	}

	dispatch(name: string, event: any): void {
		for (const listener of this.listeners.get(name) ?? []) listener(event);
	}
}

class FakeBadge {
	ownerDocument: FakeDocument | null = null;
	readonly classList = new FakeClassList();
	readonly labels: Array<{ classList: FakeClassList; style: Record<string, unknown>; textContent: string }> = [];
	readonly style: Record<string, unknown> & { setProperty: (name: string, value: string) => void } = {
		setProperty: () => {}
	};
	readonly listeners = new Map<string, Array<(event: any) => void>>();
	readonly blur = vi.fn();
	type = "";
	draggable = false;

	createSpan(): { classList: FakeClassList; style: Record<string, unknown>; textContent: string } {
		const label = { classList: new FakeClassList(), style: {}, textContent: "" };
		this.labels.push(label);
		return label;
	}

	removeAttribute(): void {}
	setAttribute(): void {}

	addEventListener(name: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	}

	dispatch(name: string, event: any): void {
		for (const listener of this.listeners.get(name) ?? []) listener(event);
	}
}

class FakeOverlay {
	readonly badges: FakeBadge[] = [];

	constructor(private readonly document: FakeDocument) {}

	replaceChildren(): void {
		this.badges.length = 0;
	}

	createEl(): FakeBadge {
		const badge = new FakeBadge();
		badge.ownerDocument = this.document;
		this.badges.push(badge);
		return badge;
	}
}

function todayKey(): string {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function interactionEvent(): any {
	return { preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false, metaKey: false };
}

function makeCanvas(options: {
	entryPath?: string;
	activeFilePath?: string;
	pinnedFile?: "date" | "dock" | null;
	reviewState?: "draft" | "reviewed";
} = {}): { canvas: any; badge: FakeBadge; overlay: FakeOverlay; document: FakeDocument; openFile: ReturnType<typeof vi.fn>; clearHover: ReturnType<typeof vi.fn> } {
	const document = new FakeDocument();
	const root = {
		clientHeight: 200,
		ownerDocument: document,
		getBoundingClientRect: () => ({ height: 200, width: 300, top: 0, left: 0 })
	};
	const overlay = new FakeOverlay(document);
	const entryPath = options.entryPath ?? "notes/current.md";
	const activeFilePath = options.activeFilePath ?? entryPath;
	const file = new TFile(entryPath);
	const leaf = new WorkspaceLeaf();
	const openFile = vi.fn(async () => {});
	leaf.openFile = openFile;
	const clearHover = vi.fn();
	const canvas: any = {
		root,
		pinOverlayEl: overlay,
		lastPinOverlaySignature: null,
		plugin: {
			indexer: {
				getIndexedPaths: () => [file.path],
				getFileIndexData: (path: string) => path === file.path ? ({
					cdate: {
						date: todayKey(),
						file: file.path,
						blockStart: 0,
						blockEnd: 0,
						summary: "Current record",
						source: "cdate",
						reviewState: options.reviewState ?? "reviewed"
					},
					namedDate: null,
					dateProp: null,
					pinnedFile: options.pinnedFile ?? null
				}) : null
			},
			app: {
				vault: { getAbstractFileByPath: () => file },
				workspace: {
					getLeaf: () => leaf,
					getMostRecentLeaf: () => leaf,
					getLeavesOfType: () => [leaf],
					revealLeaf: async () => {},
					setActiveLeaf: () => {}
				}
			}
		},
		ctx: { save: () => {}, restore: () => {}, measureText: () => ({ width: 20 }), font: "" },
		layouts: [],
		scale: 1,
		offsetY: -1000,
		activeFilePath,
		activeFileTimelineEntry: null,
		semanticRelatedPaths: null,
		clearHover,
		keepHoverAfterMenu: false,
		getToday: () => new Date(),
		getTodayOffset: () => 80,
		cancelFocusClear: () => {},
		requestHoverAnimation: () => {},
		scheduleVisibilityCheck: () => {},
		hoverDateIndex: null,
		hoverSummary: null,
		hoverTarget: 0,
		hoverAnim: 0,
		animDateIndex: null,
		animSummary: null,
		index: {},
		pendingVisibilityDraw: false
	};

	updatePinOverlay(canvas);
	const badge = overlay.badges[0];
	if (!badge) throw new Error("Expected a pin badge");
	return { canvas, badge, overlay, document, openFile, clearHover };
}

afterEach(() => {
	Platform.isMobile = false;
	vi.useRealTimers();
});

describe("mobile pin-label interactions", () => {
	it("uses the active-record font weight for the virtual dock label", () => {
		const { badge } = makeCanvas();
		expect(badge.labels[0]?.style.font).toMatch(/^700 8px /);
	});

	it("mirrors draft italics for virtual and persisted pin labels", () => {
		const { badge: virtualBadge } = makeCanvas({ reviewState: "draft" });
		expect(virtualBadge.labels[0]?.style.font).toMatch(/^italic 700 8px /);

		const { badge: pinnedBadge } = makeCanvas({
			entryPath: "notes/pinned.md",
			activeFilePath: "notes/active.md",
			pinnedFile: "dock",
			reviewState: "draft"
		});
		expect(pinnedBadge.labels[0]?.style.font).toMatch(/^italic 8px /);
	});

	it("refreshes the active virtual label from the updated record", () => {
		const { canvas, overlay } = makeCanvas();
		const date = todayKey();
		const selected = {
			date,
			file: "notes/current.md",
			blockStart: 12,
			blockEnd: 12,
			summary: "Before update",
			source: "content",
			reviewState: "reviewed"
		};
		canvas.activeFileTimelineEntry = selected;
		updatePinOverlay(canvas);
		expect(overlay.badges[0]?.labels[0]?.textContent).toBe("Before update");

		canvas.plugin.indexer.index = {
			[date]: [{ ...selected, summary: "After update", reviewState: "draft" }]
		};
		updatePinOverlay(canvas);

		expect(overlay.badges[0]?.labels[0]?.textContent).toBe("After update");
		expect(overlay.badges[0]?.labels[0]?.style.font).toMatch(/^italic 700 8px /);
	});

	it("turns a same-label second touch into focus instead of a delayed open", async () => {
		Platform.isMobile = true;
		vi.useFakeTimers();
		const { canvas, badge, document, openFile, clearHover } = makeCanvas();
		const firstClick = interactionEvent();
		badge.dispatch("click", firstClick);
		const pending = canvas.pendingPinOpen;
		expect(pending).not.toBeNull();

		document.dispatch("touchstart", { target: { closest: () => ({}) } });
		expect(canvas.pendingPinOpen).toBe(pending);
		badge.dispatch("touchstart", { touches: [{ clientX: 10, clientY: 10 }] });
		expect(canvas.pendingPinOpen).toBe(pending);
		badge.classList.add("is-menu-hovered");
		badge.dispatch("click", interactionEvent());

		expect(canvas.pendingPinOpen).toBeNull();
		expect(canvas.animatingView).toBe(true);
		expect(openFile).not.toHaveBeenCalled();
		expect(badge.classList.contains("is-menu-hovered")).toBe(false);
		expect(badge.classList.contains("is-touch-unhovered")).toBe(true);
		expect(badge.blur).toHaveBeenCalledTimes(1);
		expect(clearHover).toHaveBeenCalledWith(true);

		await vi.advanceTimersByTimeAsync(400);
		expect(openFile).not.toHaveBeenCalled();
	});

	it("cancels a pending pin open when the next touch is outside a pin", async () => {
		vi.useFakeTimers();
		const { canvas, badge, document, openFile } = makeCanvas();
		badge.dispatch("click", interactionEvent());
		expect(canvas.pendingPinOpen).not.toBeNull();

		document.dispatch("touchstart", { target: { closest: () => null } });
		expect(canvas.pendingPinOpen).toBeNull();

		await vi.advanceTimersByTimeAsync(400);
		expect(openFile).not.toHaveBeenCalled();
	});

	it("clears the label interaction state after a delayed single-tap open", async () => {
		Platform.isMobile = true;
		vi.useFakeTimers();
		const { canvas, badge, overlay, openFile, clearHover } = makeCanvas();
		badge.classList.add("is-menu-hovered");
		badge.dispatch("click", interactionEvent());

		await vi.advanceTimersByTimeAsync(301);

		expect(openFile).toHaveBeenCalledTimes(1);
		expect(badge.classList.contains("is-menu-hovered")).toBe(false);
		expect(badge.classList.contains("is-touch-unhovered")).toBe(true);
		expect(badge.blur).toHaveBeenCalledTimes(1);
		expect(clearHover).toHaveBeenCalledWith(true);

		canvas.lastPinOverlaySignature = null;
		updatePinOverlay(canvas);
		expect(overlay.badges[0]?.classList.contains("is-touch-unhovered")).toBe(true);
	});
});
