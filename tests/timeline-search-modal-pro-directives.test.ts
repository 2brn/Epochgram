import { describe, expect, it, vi } from "vitest";

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

describe("TimelineSearchModal instructions", () => {
	it("does not show removed !directive help", () => {
		const modal: any = new TimelineSearchModal({} as any, { initial: "" });
		const cmds = (modal.instructions ?? []).map((x: any) => String(x?.command ?? ""));
		const bangCmds = cmds.filter((c: string) => c.startsWith("!"));
		expect(bangCmds).toEqual([]);
		const dollarCmds = cmds.filter((c: string) => c.startsWith("$"));
		expect(dollarCmds).toEqual(["$marked", "$hidden", "$similar"]);
	});
});
