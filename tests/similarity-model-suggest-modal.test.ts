import { describe, expect, it, vi } from "vitest";

class FakeInputEl {
	value = "";
	placeholder = "";
	private listeners = new Map<string, Array<(event: any) => void>>();

	addEventListener(type: string, cb: (event: any) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(cb);
		this.listeners.set(type, list);
	}

	removeEventListener(type: string, cb: (event: any) => void): void {
		const list = this.listeners.get(type) ?? [];
		this.listeners.set(type, list.filter((x) => x !== cb));
	}

	dispatchEvent(event: any): void {
		const type = String(event?.type ?? "");
		const list = this.listeners.get(type) ?? [];
		for (const cb of list) cb(event);
	}

	focus = vi.fn();
	setSelectionRange = vi.fn();
}

vi.mock("obsidian", () => {
	class SuggestModal<T> {
		app: any;
		inputEl: FakeInputEl;
		titleEl: { setText: (text: string) => void };

		constructor(app: any) {
			this.app = app;
			this.inputEl = new FakeInputEl();
			this.titleEl = { setText: () => {} };
		}

		setPlaceholder(): void {
			// no-op
		}
		setInstructions(): void {
			// no-op
		}
		onOpen(): void {
			// no-op
		}
		onClose(): void {
			// no-op
		}
		close(): void {
			// no-op
		}
	}

	return {
		App: class App {},
		Notice: class Notice {
			constructor(_msg: string, _timeout?: number) {}
		},
		SuggestModal,
	};
});

const ensureTestGlobals = () => {
	if (!(globalThis as any).Event) {
		(globalThis as any).Event = class Event {
			type: string;
			constructor(type: string) {
				this.type = type;
			}
		};
	}
	if (!(globalThis as any).window) {
		(globalThis as any).window = { requestAnimationFrame: (cb: () => void) => cb() };
	} else if (typeof (globalThis as any).window.requestAnimationFrame !== "function") {
		(globalThis as any).window.requestAnimationFrame = (cb: () => void) => cb();
	}
};

ensureTestGlobals();

import { NO_SIMILARITY_MODEL } from "../src/plugin/similarity/config";
import { SimilarityModelSuggestModal } from "../src/ui/modals/similarity-model-suggest-modal";

describe("SimilarityModelSuggestModal", () => {
	it("prefills topics picker with default model when no override is set", () => {
		const pluginStub: any = { settings: {} };
		const modal = new SimilarityModelSuggestModal({} as any, pluginStub, { focus: "topics" });

		modal.onOpen();

		expect(modal.inputEl.value).toBe("MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33");
	});

	it("opens empty when topics model is set to (no model)", () => {
		const pluginStub: any = { settings: { similarityZeroShotModelId: NO_SIMILARITY_MODEL } };
		const modal = new SimilarityModelSuggestModal({} as any, pluginStub, { focus: "topics" });

		modal.onOpen();

		expect(modal.inputEl.value).toBe("");
	});

	it("shows (no model) + default + 3 suggestions when input is empty", () => {
		const pluginStub: any = { settings: {} };
		const modal = new SimilarityModelSuggestModal({} as any, pluginStub, { focus: "topics" });

		const items = modal.getSuggestions("");
		const suggested = items.filter((x: any) => x?.kind === "suggested");
		const hasNone = items.some((x: any) => x?.kind === "none");
		const hasDefault = items.some((x: any) => x?.kind === "default");

		expect(hasNone).toBe(true);
		expect(hasDefault).toBe(true);
		expect(suggested.length).toBe(3);
		expect(items.length).toBe(5);
	});
});
