import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("obsidian", () => ({
	Platform: { isDesktopApp: true, isMobileApp: false },
}));

import { refreshAiBridgeStatusBar } from "../src/plugin/ai-bridge-status-bar";

describe("AI bridge status bar", () => {
	it("is hidden when bridge server is not started", () => {
		const classes = new Set<string>();
		const el: any = {
			style: { display: "", cursor: "" },
			textContent: "",
			addClass: (c: string) => classes.add(c),
			removeClass: (c: string) => classes.delete(c),
			setAttribute: vi.fn(),
			addEventListener: vi.fn(),
		};
		const pluginStub: any = {
			hasProAccess: () => true,
			addStatusBarItem: () => el,
			aiBridge: null,
		};
		withTrustedPro(pluginStub);

		refreshAiBridgeStatusBar(pluginStub);

		expect(classes.has("epoch-status-bridge")).toBe(true);
		expect(el.style.display).toBe("none");
		expect(el.textContent).toBe("");
		expect(classes.has("is-warning")).toBe(false);
		expect(classes.has("is-connected")).toBe(false);
	});

	it("is not red (is-connected) when bridge page is connected", () => {
		const classes = new Set<string>();
		const el: any = {
			style: { display: "", cursor: "" },
			textContent: "",
			addClass: (c: string) => classes.add(c),
			removeClass: (c: string) => classes.delete(c),
			setAttribute: vi.fn(),
			addEventListener: vi.fn(),
		};
		const pluginStub: any = {
			hasProAccess: () => true,
			addStatusBarItem: () => el,
			aiBridge: { getStatus: () => ({ clientConnected: true }) },
		};
		withTrustedPro(pluginStub);

		refreshAiBridgeStatusBar(pluginStub);

		expect(classes.has("is-warning")).toBe(false);
		expect(classes.has("is-connected")).toBe(true);
		expect(el.setAttribute).toHaveBeenCalledWith("aria-label", "AI bridge");
	});
});
