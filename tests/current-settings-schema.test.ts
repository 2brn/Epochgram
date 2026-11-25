import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { currentSettingsSignature, readCurrentSettings } from "../src/settings-schema";
import { persistenceMethods } from "../src/plugin/persistence";
import { pollingMethods } from "../src/plugin/polling";

const retired = { trackChanges: true, generateEpochs: true, summarizeAI: true, activationEnvelope: "old", similarityEmbeddingModelId: "old", completedMigrations: ["old"], inertiaDecay: 0.1 };
describe("current settings schema", () => {
	it("retains current settings without carrying unknown fields or nested filters", () => {
		const result = readCurrentSettings({ ...DEFAULT_SETTINGS, ...retired, summaryWordsCount: 8, calendarSyncIcsUrls: ["https://example.com/feed.ics"], timelineFilters: { showAttachments: true, showParsed: false, showDraftsOnly: true, showTrackedChanges: true } });
		expect(Object.keys(result).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		for (const key of Object.keys(retired)) expect(result).not.toHaveProperty(key);
		expect(result.summaryWordsCount).toBe(8); expect(result.calendarSyncIcsUrls).toEqual(["https://example.com/feed.ics"]);
		expect(result.timelineFilters).toEqual({ showAttachments: true, showParsed: false });
	});
	it("uses defaults for malformed values and never shares nested data", () => {
		const raw: any = { enableAnimation: "false", summaryWordsCount: Number.NaN, calendarSyncPeriod: "unknown", calendarSyncIcsUrls: ["https://example.com", { legacy: true }], timelineFilters: [] };
		const a = readCurrentSettings(raw), b = readCurrentSettings(null);
		expect(a.enableAnimation).toBe(true); expect(a.summaryWordsCount).toBe(DEFAULT_SETTINGS.summaryWordsCount); expect(a.calendarSyncPeriod).toBe("manual");
		expect(a.calendarSyncIcsUrls).toEqual(["https://example.com"]);
		a.calendarSyncIcsUrls!.push("another"); a.timelineFilters!.showParsed = false;
		expect(raw.calendarSyncIcsUrls).toHaveLength(2); expect(b.timelineFilters?.showParsed).toBe(true); expect(DEFAULT_SETTINGS.calendarSyncIcsUrls).toEqual([]);
	});
	it("ignores unknown fields in signatures rather than treating them as settings changes", () => {
		expect(currentSettingsSignature({ settings: { ...DEFAULT_SETTINGS, ...retired }, oldIndex: {} })).toBe(currentSettingsSignature({ settings: DEFAULT_SETTINGS }));
		expect(currentSettingsSignature(undefined)).toBeNull();
	});
	it("writes only current settings even if runtime state contains unknown keys", async () => {
		const p: any = { ...persistenceMethods, settings: { ...DEFAULT_SETTINGS, ...retired }, saveData: vi.fn(async () => {}), updateDataFileStat: vi.fn(async () => {}) };
		await p.savePluginData();
		expect(p.saveData).toHaveBeenCalledWith({ settings: readCurrentSettings(DEFAULT_SETTINGS) });
		expect(p.settings).not.toHaveProperty("trackChanges");
	});
	it("sanitizes a synchronized settings payload while preserving the session Drafts-only filter", async () => {
		const p: any = { ...persistenceMethods, ...pollingMethods, settings: readCurrentSettings(DEFAULT_SETTINGS), viewPreferences: { showDraftsOnly: true },
			loadData: async () => ({ settings: { ...DEFAULT_SETTINGS, ...retired, summaryWordsCount: 9, timelineFilters: { showAttachments: true, showParsed: true, showDraftsOnly: false } } }),
			updateDataFileStat: vi.fn(async () => {}), refreshCalendarSyncSchedule: vi.fn(), scheduleInheritedMarkRecompute: vi.fn(), refreshEpochViews: vi.fn() };
		await p.reloadIndexFromPluginData();
		expect(p.settings.summaryWordsCount).toBe(9); expect(p.settings).not.toHaveProperty("generateEpochs");
		expect(p.settings.timelineFilters).toEqual({ showAttachments: true, showParsed: true }); expect(p.viewPreferences.showDraftsOnly).toBe(true);
	});
});
