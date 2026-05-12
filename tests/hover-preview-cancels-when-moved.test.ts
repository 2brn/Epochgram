import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { TFile } from "obsidian";

import { attemptHoverPreview } from "../src/ui/epoch-canvas-hover/preview";

function ensureWindowPolyfill(): void {
	const g: any = globalThis as any;
	if (!g.window) {
		g.window = g;
	}
	if (typeof g.window.setTimeout !== "function") {
		g.window.setTimeout = setTimeout;
	}
	if (typeof g.window.clearTimeout !== "function") {
		g.window.clearTimeout = clearTimeout;
	}
	if (!g.MouseEvent) {
		g.MouseEvent = class MouseEvent {
			public type: string;
			public clientX: number;
			public clientY: number;
			public screenX: number;
			public screenY: number;
			public altKey: boolean;
			public ctrlKey: boolean;
			public metaKey: boolean;
			public shiftKey: boolean;
			public button: number;
			public buttons: number;
			public bubbles: boolean;
			public cancelable: boolean;
			public view: any;

			constructor(type: string, init: any = {}) {
				this.type = type;
				this.clientX = Number(init.clientX ?? 0);
				this.clientY = Number(init.clientY ?? 0);
				this.screenX = Number(init.screenX ?? 0);
				this.screenY = Number(init.screenY ?? 0);
				this.altKey = !!init.altKey;
				this.ctrlKey = !!init.ctrlKey;
				this.metaKey = !!init.metaKey;
				this.shiftKey = !!init.shiftKey;
				this.button = Number(init.button ?? 0);
				this.buttons = Number(init.buttons ?? 0);
				this.bubbles = !!init.bubbles;
				this.cancelable = !!init.cancelable;
				this.view = init.view;
			}
		};
	}
}

describe("hover preview delayed trigger", () => {
	beforeEach(() => {
		ensureWindowPolyfill();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function makeCanvas(overrides: any = {}) {
		const trigger = vi.fn();
		const hide = vi.fn();
		const file = new TFile("A.md");
		const canvasEl: any = {
			getBoundingClientRect: () => ({ left: 0, top: 0 }),
			style: {}
		};

		const base: any = {
			isPointerDeviceEvent: () => true,
			isDragging: false,
			previewLockedUntilAltRelease: false,
			previewLockedNotified: false,
			modKeyActive: false,
			hoverPreviewKey: null,
			hoverSummary: null,
			hoverDateIndex: 0,
			layouts: [],
			canvas: canvasEl,
			activeFilePath: null,
			hoverSourceId: "epochgram",
			hoverParent: { hoverPopover: { hide } },
			plugin: {
				app: {
					vault: {
						getAbstractFileByPath: (_p: string) => file
					},
					metadataCache: {
						fileToLinktext: () => "A"
					},
					workspace: {
						trigger
					}
				}
			},
			getToday: () => new Date("2026-03-17T00:00:00Z"),
			getDateForIndex: () => new Date("2026-03-17T00:00:00Z"),
			getFileForDate: () => file,
			findSummaryEntryAtPoint: () => null,
			lastPointerEvent: new (globalThis as any).MouseEvent("mousemove", { clientX: 10, clientY: 10, altKey: true })
		};
		return { canvas: Object.assign(base, overrides), trigger, hide };
	}

	it("does not trigger if cursor moved off before timeout", () => {
		const { canvas, trigger } = makeCanvas();

		attemptHoverPreview(canvas, canvas.lastPointerEvent);
		// Simulate mouse leaving the canvas/hover target before the delayed trigger fires.
		canvas.hoverDateIndex = null;
		canvas.hoverSummary = null;

		vi.advanceTimersByTime(550);
		expect(trigger).toHaveBeenCalledTimes(0);
		expect(canvas.hoverPreviewKey).toBe(null);
	});

	it("triggers if still hovering when timeout fires", () => {
		const { canvas, trigger } = makeCanvas();

		attemptHoverPreview(canvas, canvas.lastPointerEvent);

		vi.advanceTimersByTime(550);
		expect(trigger).toHaveBeenCalledTimes(1);
	});
});
