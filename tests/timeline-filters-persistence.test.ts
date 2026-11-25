import { describe, expect, it, vi } from "vitest";
import { epochViewSetShowAttachments, epochViewSetShowContentDates, epochViewSetShowPropDates, epochViewSyncPreferencesFromPlugin } from "../src/ui/epoch-view/filters";
function view(): any {
	return { plugin: { settings: { timelineFilters: {}, parseDatesInFrontmatter: true }, viewPreferences: {}, saveSettings: vi.fn(async () => {}) }, canvas: { setShowAttachments: vi.fn(), setShowContentDates: vi.fn(), setShowPropDates: vi.fn() }, showAttachments: false, showContentDates: true, showPropDates: true, scheduleSearchControlRefresh: vi.fn() };
}
describe("timeline filters persistence", () => {
	it("persists attachment visibility", () => {
		const v = view(); epochViewSetShowAttachments(v, true);
		expect(v.plugin.settings.timelineFilters).toEqual({ showAttachments: true, showParsed: true });
		expect(v.plugin.saveSettings).toHaveBeenCalledOnce();
	});
	it("enforces parsed/frontmatter nesting", () => {
		const v = view(); v.showContentDates = false; v.showPropDates = false;
		epochViewSetShowPropDates(v, true);
		expect(v.showContentDates).toBe(true); expect(v.showPropDates).toBe(true);
		v.plugin.saveSettings.mockClear(); epochViewSetShowContentDates(v, false);
		expect(v.showContentDates).toBe(false); expect(v.showPropDates).toBe(false);
		expect(v.plugin.settings.timelineFilters.showParsed).toBe(false); expect(v.plugin.saveSettings).toHaveBeenCalledOnce();
	});
	it("syncs preferences without writing settings", () => {
		const v = view(); epochViewSyncPreferencesFromPlugin(v, { showAttachments: true, showParsed: false });
		expect(v.showAttachments).toBe(true); expect(v.showContentDates).toBe(false); expect(v.plugin.saveSettings).not.toHaveBeenCalled();
	});
});
