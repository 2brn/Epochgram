import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const captured = vi.hoisted(() => ({ button: null as any }));
vi.mock("obsidian", async () => ({ ...(await vi.importActual("obsidian")), Setting: class {
	descEl = { createEl: () => ({ addEventListener() {} }) };
	constructor(_root: any) {} setName() { return this; }
	addButton(callback: any) {
		const button = { buttonEl: { classList: { add: vi.fn() } }, setButtonText: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis() };
		captured.button = button; callback(button); return this;
	}
} }));
vi.mock("../src/settings-ui/general", () => ({ defineGeneralViewSettings: () => [], defineIndexerSettings: () => [] }));
vi.mock("../src/settings-ui/advanced", () => ({ defineAdvancedSettings: () => [] }));
vi.mock("../src/settings-ui/maintenance", () => ({ defineMaintenanceSetting: () => ({ name: "Index", render() {} }) }));
vi.mock("../src/settings-ui/setting-groups", () => ({ createSettingGroup: () => ({ itemsEl: {} }) }));
import { EpochSettingTab } from "../src/settings";
describe("community button presentation", () => {
	it("uses a current community class with the original red hover/focus colors", () => {
		const tab = new EpochSettingTab({} as any, { manifest: { version: "2.0.0" } } as any);
		tab.display();
		expect(captured.button.setButtonText).toHaveBeenCalledWith("Reddit community");
		expect(captured.button.buttonEl.classList.add).toHaveBeenCalledWith("epoch-community-button");
		const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
		expect(css).toMatch(/\.epoch-community-button\.mod-cta\s*\{[^}]*background-color:\s*#c14d58/s);
		expect(css).toMatch(/\.epoch-community-button:hover,[^{]*\.epoch-community-button\.mod-cta:focus-visible\s*\{[^}]*background-color:\s*#ae4350/s);
		expect(css).not.toContain("epoch-pro-get-pro-button");
	});
});
