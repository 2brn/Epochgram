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
import { Platform } from "obsidian";

describe("TimelineSearchModal instructions", () => {
	it("shows ctrl on non-mac and cmd on mac for new-tab shortcut", () => {
		(Platform as any).isMacOS = false;
		const modalWin: any = new TimelineSearchModal({} as any, { initial: "" });
		const winCmds = (modalWin.instructions ?? []).map((x: any) => String(x?.command ?? ""));
		expect(winCmds).toContain("ctrl ↵");
		expect(winCmds).not.toContain("cmd ↵");

		(Platform as any).isMacOS = true;
		const modalMac: any = new TimelineSearchModal({} as any, { initial: "" });
		const macCmds = (modalMac.instructions ?? []).map((x: any) => String(x?.command ?? ""));
		expect(macCmds).toContain("cmd ↵");
		expect(macCmds).not.toContain("ctrl ↵");
	});

	it("does not show removed !directive help", () => {
		(Platform as any).isMacOS = false;
		const modal: any = new TimelineSearchModal({} as any, { initial: "" });
		const cmds = (modal.instructions ?? []).map((x: any) => String(x?.command ?? ""));
		const bangCmds = cmds.filter((c: string) => c.startsWith("!"));
		expect(bangCmds).toEqual([]);
		const dollarCmds = cmds.filter((c: string) => c.startsWith("$"));
		expect(dollarCmds).toEqual(["$marked", "$hidden", "$similar"]);
	});
});
