import { describe, expect, it, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance-reset";
import { DEFAULT_SETTINGS } from "../src/settings-model";
function plugin(): any {
	return { settings: { ...DEFAULT_SETTINGS, filenameWordsCount: 7 }, viewPreferences: {}, ensureIndexLoaded: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}), refreshCalendarSyncSchedule: vi.fn(), refreshIndexSmartWithProgress: vi.fn(async () => {}), clearEpochJsonFilesAndRebuild: vi.fn(async () => {}), clearInheritedMarksCache: vi.fn(), refreshEpochViews: vi.fn(), timelineSearchIndex: { clear: vi.fn() }, app: { vault: { configDir: ".obsidian", adapter: { exists: async () => false } }, workspace: { getLeavesOfType: () => [] } } };
}
describe("reset actions", () => {
	it("can run twice and resets settings and calendar scheduling", async () => {
		const p = plugin();
		for (let i = 0; i < 2; i++) await runReset(p, { settings: true, search: false, dataFiles: false });
		expect(p.settings).toEqual(DEFAULT_SETTINGS); expect(p.settings).not.toBe(DEFAULT_SETTINGS);
		expect(p.saveSettings).toHaveBeenCalledTimes(2); expect(p.refreshCalendarSyncSchedule).toHaveBeenCalledTimes(2); expect(p.__epochResetInFlight).toBe(false);
	});
	it("clears the in-flight flag on errors", async () => {
		const p = plugin(); p.saveSettings.mockRejectedValueOnce(new Error("failure"));
		await expect(runReset(p, { settings: true, search: false, dataFiles: false })).rejects.toThrow("failure");
		expect(p.__epochResetInFlight).toBe(false);
	});
	it("leaves index data untouched when no reset is selected", async () => {
		const p = plugin(); await runReset(p, { settings: false, search: false, dataFiles: false });
		expect(p.clearInheritedMarksCache).not.toHaveBeenCalled(); expect(p.clearEpochJsonFilesAndRebuild).not.toHaveBeenCalled(); expect(p.refreshEpochViews).not.toHaveBeenCalled();
	});
	it("resets search and active session query without changing other settings", async () => {
		const p = plugin(), setSearchQueryInternal = vi.fn();
		p.app.workspace.getLeavesOfType = () => [{ view: { setSearchQueryInternal } }]; p.__timelineSearchIndexVersion = 41;
		await runReset(p, { settings: false, search: true, dataFiles: false });
		expect(p.timelineSearchIndex.clear).toHaveBeenCalledOnce(); expect(setSearchQueryInternal).toHaveBeenCalledWith(""); expect(p.__timelineSearchIndexVersion).toBe(42);
		expect(p.settings.filenameWordsCount).toBe(7); expect(p.saveSettings).not.toHaveBeenCalled();
	});
	it("rebuilds retained index data when selected", async () => {
		const p = plugin(); await runReset(p, { settings: false, search: false, dataFiles: true });
		expect(p.clearEpochJsonFilesAndRebuild).toHaveBeenCalledOnce(); expect(p.clearInheritedMarksCache).toHaveBeenCalledOnce();
	});
});
