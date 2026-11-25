import { beforeEach, describe, expect, it, vi } from "vitest";
const captures = vi.hoisted(() => ({ settings: [] as any[], groups: [] as string[] }));
vi.mock("obsidian", async () => ({ ...(await vi.importActual("obsidian")), Setting: class {
	name = ""; reset: any; slider: any; dropdown: any; texts: any[] = [];
	settingEl = { classList: { add() {} } }; descEl = { createEl: vi.fn() };
	constructor(_root: any) { captures.settings.push(this); }
	setName(name: string) { this.name = name; return this; } setDesc() { return this; }
	control() { return { value: undefined as any, change: undefined as any, handlers: {} as any, inputEl: undefined as any,
		setValue(value: any) { this.value = value; return this; }, getValue() { return this.value; }, setLimits() { return this; }, setPlaceholder() { return this; }, addOption() { return this; }, onChange(fn: any) { this.change = fn; return this; } }; }
	addToggle(fn: any) { fn(this.control()); return this; }
	addSlider(fn: any) { this.slider = this.control(); fn(this.slider); return this; }
	addDropdown(fn: any) { this.dropdown = this.control(); fn(this.dropdown); return this; }
	addText(fn: any) { const input = this.control(); input.inputEl = { classList: { add() {}, toggle() {} }, addEventListener: (name: string, cb: any) => { input.handlers[name] = cb; } }; this.texts.push(input); fn(input); return this; }
} }));
vi.mock("../src/settings-ui/setting-groups", () => ({ createSettingGroup: (_root: any, name: string) => { captures.groups.push(name); return { itemsEl: {} }; } }));
vi.mock("../src/settings-ui/info-reset-gesture", () => ({ registerInfoResetGesture: (setting: any, reset: any) => { setting.reset = reset; } }));
vi.mock("../src/ui/modals/path-suggest", () => ({ FolderPathSuggest: class {}, FilePathSuggest: class {} }));
import { renderAdvancedSettings } from "../src/settings-ui/advanced";
import { DEFAULT_SETTINGS } from "../src/settings-model";
beforeEach(() => { captures.settings.length = 0; captures.groups.length = 0; });
function setup(overrides: any = {}) {
	const plugin: any = { settings: { ...structuredClone(DEFAULT_SETTINGS), ...overrides }, getDailyNoteFolder: () => "", onSettingsChanged: vi.fn(async () => {}) };
	const scroll = { scrollTop: 250 }, container: any = { closest: () => scroll }, refresh = vi.fn(() => { scroll.scrollTop = 0; });
	renderAdvancedSettings(container, {} as any, plugin, refresh);
	return { plugin, scroll, refresh };
}
describe("retained advanced setting interactions", () => {
	it("restores title-threshold and calendar-period defaults through their reset gestures", async () => {
		const { plugin } = setup({ similarityTitleJwThreshold: 0.4, calendarSyncPeriod: "1m" });
		const title = captures.settings.find(row => row.name.startsWith("Title threshold"));
		await title.reset(); expect(title.slider.value).toBe(1); expect(plugin.settings.similarityTitleJwThreshold).toBe(1);
		const period = captures.settings.find(row => row.name === "Sync period");
		await period.reset(); expect(period.dropdown.value).toBe("manual"); expect(plugin.settings.calendarSyncPeriod).toBe("manual");
		expect(plugin.onSettingsChanged).toHaveBeenCalledWith("calendarSyncPeriod");
	});
	it("normalizes an invalid sync period for the dropdown", () => {
		setup({ calendarSyncPeriod: "invalid" }); expect(captures.settings.find(row => row.name === "Sync period").dropdown.value).toBe("manual");
	});
	it("preserves retained section order, docs access, and scroll position after editing feeds", async () => {
		const { scroll, refresh } = setup();
		expect(captures.groups).toEqual(["Similarity", "Calendar sync"]);
		const links = captures.settings.find(row => row.name === "ICS link");
		expect(links.descEl.createEl).toHaveBeenCalledWith("a", expect.objectContaining({ href: "https://www.epochgram.com/docs#calendar-sync" }));
		links.texts[0].setValue("https://example.com/calendar.ics"); links.texts[0].handlers.blur();
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(refresh).toHaveBeenCalledOnce(); expect(scroll.scrollTop).toBe(250);
	});
});
