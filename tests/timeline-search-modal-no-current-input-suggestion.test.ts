import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class SuggestModal {
		app: any;
		placeholder = "";
		instructions: Array<{ command: string; purpose: string }> = [];
		constructor(app: any) {
			this.app = app;
		}
		setPlaceholder(p: string) {
			this.placeholder = String(p || "");
		}
		setInstructions(i: Array<{ command: string; purpose: string }>) {
			this.instructions = Array.isArray(i) ? i : [];
		}
	}

	return {
		SuggestModal,
		Platform: { isMobile: false },
		App: class {}
	};
});

import { TimelineSearchModal } from "../src/ui/modals/timeline-search-modal";

describe("TimelineSearchModal suggestions", () => {
	beforeEach(() => {
		try {
			(TimelineSearchModal as any).sessionLastNonEmptyQuery = "";
		} catch {
			// ignore
		}
	});

	it("does not add a current-input suggestion when there are no matches", () => {
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches: () => []
		});

		const suggestions = modal.getSuggestions("alpha");
		expect(Array.isArray(suggestions)).toBe(true);
		expect(suggestions.length).toBe(2);
		expect((suggestions[0] as any).kind).toBe("filter");
		expect((suggestions[1] as any).kind).toBe("empty");
	});

	it("shows recent records when the input is empty", () => {
		const getTopMatches = vi.fn((query: string) => {
			if (String(query || "").trim() !== "") return [];
			return [
				{ entry: { date: "2020-01-01", file: "notes/a.md" }, label: "A" },
				{ entry: { date: "2020-01-02", file: "notes/b.md" }, label: "B" }
			];
		});
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches
		});

		const suggestions = modal.getSuggestions("");
		expect(getTopMatches).toHaveBeenCalled();
		expect(suggestions.length).toBe(3);
		expect((suggestions[0] as any).kind).toBe("record");
		expect((suggestions[1] as any).kind).toBe("record");
		expect((suggestions[2] as any).kind).toBe("empty");
	});

	it("shows default records when the input is empty even after a prior query", () => {
		const getTopMatches = vi.fn((query: string) => {
			if (String(query || "").trim() === "alpha") {
				return [{ entry: { date: "2020-01-03", file: "notes/c.md" }, label: "C" }];
			}
			if (String(query || "").trim() === "") {
				return [{ entry: { date: "2020-01-01", file: "notes/a.md" }, label: "A" }];
			}
			return [];
		});
		{
			// Seed cached last query.
			const modalSeed: any = new TimelineSearchModal({} as any, {
				initial: "",
				getTopMatches
			});
			modalSeed.getSuggestions("alpha");
		}
		getTopMatches.mockClear();

		// Fresh modal (close/reopen): empty input should always show default suggestions.
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches
		});
		const suggestions = modal.getSuggestions("");
		expect(getTopMatches).toHaveBeenCalledWith("", expect.any(Number));
		expect(suggestions.length).toBe(2);
		expect((suggestions[0] as any).kind).toBe("record");
		expect(((suggestions[0] as any).entry as any)?.file).toBe("notes/a.md");
		expect((suggestions[1] as any).kind).toBe("empty");
	});

	it("clearing a non-empty query back to empty shows default suggestions", () => {
		const getTopMatches = vi.fn((query: string) => {
			const q = String(query || "").trim();
			if (q === "alpha") return [{ entry: { date: "2020-01-03", file: "notes/c.md" }, label: "C" }];
			if (q === "") return [{ entry: { date: "2020-01-01", file: "notes/a.md" }, label: "A" }];
			return [];
		});
		// Seed last-query cache (simulate prior session query).
		{
			const modalSeed: any = new TimelineSearchModal({} as any, { initial: "", getTopMatches });
			modalSeed.getSuggestions("alpha");
		}
		getTopMatches.mockClear();

		// New modal opens with empty input: should show default suggestions.
		const modal: any = new TimelineSearchModal({} as any, { initial: "", getTopMatches });
		let suggestions = modal.getSuggestions("");
		expect(getTopMatches).toHaveBeenCalledWith("", expect.any(Number));
		expect(((suggestions[0] as any).entry as any)?.file).toBe("notes/a.md");

		// If the user types and then clears back to empty, it should show defaults.
		getTopMatches.mockClear();
		modal.getSuggestions("alpha");
		getTopMatches.mockClear();
		suggestions = modal.getSuggestions("");
		expect(getTopMatches).toHaveBeenCalledWith("", expect.any(Number));
		expect(((suggestions[0] as any).entry as any)?.file).toBe("notes/a.md");
	});

	it("treats !tokens as normal text", () => {
		const getTopMatches = vi.fn(() => []);
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches
		});

		const suggestions = modal.getSuggestions("!wrong");
		expect(suggestions.length).toBe(2);
		expect((suggestions[0] as any).kind).toBe("filter");
		expect((suggestions[1] as any).kind).toBe("empty");
	});

	it("caps record suggestions at MAX_SUGGESTIONS items (plus Filter and Clear)", () => {
		const getTopMatches = vi.fn((_query: string, max: number) => {
			return Array.from({ length: 100 }).map((_, i) => ({
				entry: { date: "2020-01-01", file: `notes/${i}.md` },
				label: `L${i}`
			}));
		});
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			getTopMatches
		});
		const maxRecords = Number((TimelineSearchModal as any).MAX_SUGGESTIONS ?? 0);
		const suggestions = modal.getSuggestions("alpha");
		expect(suggestions.length).toBe(maxRecords + 2);
		expect((suggestions[0] as any).kind).toBe("record");
		expect((suggestions[maxRecords] as any).kind).toBe("filter");
		expect((suggestions[maxRecords + 1] as any).kind).toBe("empty");
	});

	it("uses maxSuggestions override when provided", () => {
		const getTopMatches = vi.fn((_query: string, _max: number) => {
			return Array.from({ length: 10 }).map((_, i) => ({
				entry: { date: "2020-01-01", file: `notes/${i}.md` },
				label: `L${i}`
			}));
		});
		const modal: any = new TimelineSearchModal({} as any, {
			initial: "",
			maxSuggestions: 3,
			getTopMatches
		});
		const suggestions = modal.getSuggestions("alpha");
		expect(getTopMatches).toHaveBeenCalledWith("alpha", 3);
		expect(suggestions.length).toBe(5);
		expect((suggestions[0] as any).kind).toBe("record");
		expect((suggestions[3] as any).kind).toBe("filter");
		expect((suggestions[4] as any).kind).toBe("empty");
	});
});
