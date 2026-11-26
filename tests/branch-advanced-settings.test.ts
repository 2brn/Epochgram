import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireApiVersion, Setting } from "obsidian";
const captures = vi.hoisted(() => ({ settings: [] as any[], groups: [] as string[] }));
vi.mock("obsidian", async () => ({ ...(await vi.importActual("obsidian")), requireApiVersion: vi.fn(() => false), Setting: class {
	name = ""; desc = ""; reset: any; slider: any; dropdown: any; texts: any[] = []; buttons: any[] = [];
	settingEl = { classList: { add() {} } }; descEl = { createEl: vi.fn(() => ({ addEventListener() {} })) };
	constructor(_root: any) { captures.settings.push(this); }
	setName(name: string) { this.name = name; return this; } setDesc(desc: string) { this.desc = desc; return this; }
	control() { return { value: undefined as any, change: undefined as any, handlers: {} as any, inputEl: undefined as any,
		setValue(value: any) { this.value = value; return this; }, getValue() { return this.value; }, setLimits() { return this; }, setPlaceholder() { return this; }, addOption() { return this; }, onChange(fn: any) { this.change = fn; return this; } }; }
	addButton(fn: any) {
		const button = { buttonEl: { classList: { add: vi.fn() } }, setButtonText: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis(), setDestructive: vi.fn() };
		this.buttons.push(button); fn(button); return this;
	}
	addToggle(fn: any) { fn(this.control()); return this; }
	addSlider(fn: any) { this.slider = this.control(); fn(this.slider); return this; }
	addDropdown(fn: any) { this.dropdown = this.control(); fn(this.dropdown); return this; }
	addText(fn: any) { const input = this.control(); input.inputEl = { classList: { add() {}, toggle() {} }, addEventListener: (name: string, cb: any) => { input.handlers[name] = cb; } }; this.texts.push(input); fn(input); return this; }
} }));
vi.mock("../src/settings-ui/setting-groups", () => ({ createSettingGroup: (_root: any, name: string) => { captures.groups.push(name); return { itemsEl: {} }; } }));
vi.mock("../src/settings-ui/info-reset-gesture", () => ({ registerInfoResetGesture: (setting: any, reset: any) => { setting.reset = reset; } }));
vi.mock("../src/ui/modals/path-suggest", () => ({ FolderPathSuggest: class {}, FilePathSuggest: class {} }));
import { defineAdvancedSettings } from "../src/settings-ui/advanced";
import { renderLegacySettings } from "../src/settings-ui/setting-definitions";
import { EpochSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, type EpochSettings } from "../src/settings-model";
beforeEach(() => {
	captures.settings.length = 0;
	captures.groups.length = 0;
	vi.mocked(requireApiVersion).mockReset().mockReturnValue(false);
});
function makePlugin(overrides: Partial<EpochSettings> = {}) {
	return { settings: { ...structuredClone(DEFAULT_SETTINGS), ...overrides }, getDailyNoteFolder: () => "", onSettingsChanged: vi.fn(async () => {}) };
}
function setup(overrides: any = {}) {
	const plugin = makePlugin(overrides);
	const scroll = { scrollTop: 250 }, container: any = { closest: () => scroll }, refresh = vi.fn(() => { scroll.scrollTop = 0; });
	renderLegacySettings(container, defineAdvancedSettings(container, {} as any, plugin as any, refresh));
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

describe("native settings definitions", () => {
	it("exposes every setting for search without rendering controls", () => {
		const plugin = makePlugin();
		const tab = new EpochSettingTab({} as any, plugin as any);
		const sections = tab.getSettingDefinitions();
		expect(sections.map(section => section.heading)).toEqual([undefined, "Indexer", "Similarity", "Calendar sync", undefined]);
		expect(sections.flatMap(section => section.items).filter(item => item.searchable !== false).map(item => item.name)).toEqual([
			"Open on startup", "Enable animation", "Record width limit", "Search results count",
			"Anchor mdate", "Anchor property", "Summary property", "Parse all properties", "Filename length", "Summary length", "Index",
			"Use links", "Use tags", "Title threshold", "ICS link", "Sync period", "Event file location", "Template file location"
		]);
		expect(captures.settings).toHaveLength(0);
		expect(plugin.onSettingsChanged).not.toHaveBeenCalled();
	});

	it("normalizes and resets the anchor property with the same callbacks as the old UI", async () => {
		const plugin = makePlugin();
		const tab = new EpochSettingTab({} as any, plugin as any);
		const indexer = tab.getSettingDefinitions().filter(section => section.heading === "Indexer")
			.map(section => ({ ...section, items: section.items.slice(0, 2) }));
		renderLegacySettings(tab.containerEl, indexer);
		const [anchorMdate, property] = captures.settings;
		property.texts[0].setValue(" published ");
		property.texts[0].handlers.blur();
		expect(plugin.settings.yamlDateProperty).toBe("published");
		expect(anchorMdate.desc).toContain("`published`");
		expect(plugin.onSettingsChanged).toHaveBeenCalledWith("yamlDateProperty");
		await property.reset();
		expect(property.texts[0].value).toBe("date");
		expect(anchorMdate.desc).toContain("`date`");
	});

	it.each([true, false])("refreshes the calendar inputs through the available API (native=%s)", async (native) => {
		vi.mocked(requireApiVersion).mockReturnValue(native);
		const plugin = makePlugin();
		const tab = new EpochSettingTab({} as any, plugin as any);
		const scroll = { scrollTop: 250 };
		const refresh = vi.fn(() => { scroll.scrollTop = 0; });
		tab.containerEl = { closest: () => scroll, empty: native ? vi.fn() : refresh } as unknown as HTMLElement;
		if (native) tab.update = refresh;
		const display = vi.spyOn(tab, "display");
		const definition = tab.getSettingDefinitions().flatMap(section => section.items).find(row => row.name === "ICS link");
		if (!definition) throw new Error("Missing ICS link definition");
		definition.render(new Setting(tab.containerEl));
		const input = captures.settings[0].texts[0];
		input.setValue("webcal://example.com/events.ics");
		input.handlers.blur();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
		expect(requireApiVersion).toHaveBeenCalledWith("1.13.0");
		expect(display).not.toHaveBeenCalled();
		expect(scroll.scrollTop).toBe(250);
		expect(plugin.settings.calendarSyncIcsUrls).toEqual(["webcal://example.com/events.ics"]);
		expect(plugin.onSettingsChanged).toHaveBeenCalledWith("calendarSyncIcsUrls");
	});

	it.each([true, false])("uses the available reset button styling (native=%s)", (native) => {
		vi.mocked(requireApiVersion).mockReturnValue(native);
		const tab = new EpochSettingTab({} as any, makePlugin() as any);
		const definition = tab.getSettingDefinitions().flatMap(section => section.items).find(row => row.name === "Index");
		if (!definition) throw new Error("Missing Index setting definition");
		definition.render(new Setting(tab.containerEl));
		const reset = captures.settings[0].buttons[1];
		expect(requireApiVersion).toHaveBeenCalledWith("1.13.0");
		if (native) {
			expect(reset.setDestructive).toHaveBeenCalledOnce();
			expect(reset.buttonEl.classList.add).not.toHaveBeenCalled();
		} else {
			expect(reset.setDestructive).not.toHaveBeenCalled();
			expect(reset.buttonEl.classList.add).toHaveBeenCalledWith("mod-warning");
		}
	});
});
