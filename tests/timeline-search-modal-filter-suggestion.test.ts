import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class SuggestModal {
		app: any;
		placeholder = "";
		instructions: Array<{ command: string; purpose: string }> = [];
		modalEl: any = { toggleClass: vi.fn(), addClass: vi.fn() };
		titleEl: any = { setText: vi.fn() };
		inputEl: any = { value: "", type: "", dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
		constructor(app: any) {
			this.app = app;
		}
		setPlaceholder(p: string) {
			this.placeholder = String(p || "");
		}
		setInstructions(i: Array<{ command: string; purpose: string }>) {
			this.instructions = Array.isArray(i) ? i : [];
		}
		close() {}
	}

	return {
		SuggestModal,
		Platform: { isMobile: false },
		App: class {}
	};
});

import { TimelineSearchModal } from "../src/ui/modals/timeline-search-modal";

describe("TimelineSearchModal (Filter) suggestion", () => {
	it("includes (Filter) and (Clear) suggestions for non-empty input", () => {
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches: () => [
				{ entry: { date: "2020-01-01", file: "notes/a.md" }, label: "A" },
				{ entry: { date: "2020-01-02", file: "notes/b.md" }, label: "B" }
			]
		});

		const suggestions = modal.getSuggestions("alpha");
		expect(suggestions.length).toBe(4);
		expect((suggestions[0] as any).kind).toBe("record");
		expect((suggestions[1] as any).kind).toBe("record");
		expect((suggestions[2] as any).kind).toBe("filter");
		expect((suggestions[3] as any).kind).toBe("empty");
	});

	it("always appends (Clear) to the end for non-empty input", () => {
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches: () => []
		});

		const suggestions = modal.getSuggestions("alpha");
		expect(suggestions.length).toBe(2);
		expect((suggestions[0] as any).kind).toBe("filter");
		expect((suggestions[1] as any).kind).toBe("empty");
	});

	it("choosing (Filter) calls onCommit with the query", () => {
		const onCommit = vi.fn();
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches: () => [],
			onCommit
		});

		const [filter] = modal.getSuggestions("alpha");
		expect((filter as any).kind).toBe("filter");

		modal.onChooseSuggestion(filter as any, {} as any);
		expect(onCommit).toHaveBeenCalledWith("alpha");
	});

	it("renders filter suggestion as (Filter {query})", () => {
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches: () => []
		});
		const [filter] = modal.getSuggestions("alpha");
		const el: any = { setText: vi.fn() };
		modal.renderSuggestion(filter as any, el);
		expect(el.setText).toHaveBeenCalledWith("(Filter alpha)");
	});
});
