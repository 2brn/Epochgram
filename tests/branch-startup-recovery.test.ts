import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "obsidian";
import { makeReviewPlugin } from "./helpers/review-plugin";
vi.mock("../src/settings", async () => ({ ...(await vi.importActual("../src/settings-model")), EpochSettingTab: class {} }));
vi.mock("../src/ui/epoch-view", () => ({ EpochView: class {} }));
vi.mock("../src/plugin/whats-new", () => ({ maybeOpenWhatsNewOnStartup: vi.fn() }));
import { lifecycleMethods } from "../src/plugin/lifecycle";
import { indexingMethods } from "../src/plugin/indexing";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
	const p = await makeReviewPlugin(), events = new Map<string, () => void>(), cleanups: Array<() => void> = [];
	Object.assign(p, { manifest: { id: "epochgram" }, loadData: vi.fn(async () => ({ settings: { ...p.settings, openEpochViewOnStartup: true } })), computeDataSignature: () => "settings",
		initializeIndex: vi.fn(async () => true), rebuildIndexWithProgress: vi.fn(async () => {}), openEpochView: vi.fn(async () => {}),
		register: (fn: () => void) => cleanups.push(fn), applyDailyNotesDefaults: vi.fn() });
	for (const name of ["registerCustomIcons", "registerFileEvents", "addSettingTab", "registerEvent", "addRibbonIcon", "registerView", "registerHoverLinkSource", "registerFileMenu", "registerInterval", "maybeRunCalendarSyncOnStartup", "addCommand"]) p[name] = vi.fn();
	p.app.workspace.on = (name: string, fn: () => void) => events.set(name, fn);
	p.app.workspace.onLayoutReady = (fn: () => void) => events.set("layout-ready", fn);
	return { p, events, cleanups };
}
describe("branch startup regression coverage", () => {
	it("recovers from a thrown initializer with a fallback rebuild", async () => {
		const { p } = await setup(); p.initializeIndex.mockRejectedValueOnce(new Error("temporary"));
		await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		expect(p.rebuildIndexWithProgress).toHaveBeenCalledOnce(); expect(p.indexReady).toBe(true);
	});
	it("retries a transient failure of the initial rebuild", async () => {
		const { p } = await setup(); p.initializeIndex.mockResolvedValue(false); p.rebuildIndexWithProgress.mockRejectedValueOnce(new Error("temporary"));
		await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		expect(p.rebuildIndexWithProgress).toHaveBeenCalledTimes(2);
	});
	it("keeps startup waiters on the outer recovery promise while the real rebuild retries", async () => {
		const { p } = await setup(); p.initializeIndex.mockResolvedValue(false);
		p.rebuildIndexWithProgress = indexingMethods.rebuildIndexWithProgress.bind(p);
		let fail!: (error: Error) => void;
		p.app.vault.read.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
		await lifecycleMethods.onload.call(p);
		for (let i = 0; i < 20; i++) await Promise.resolve();
		const waiter = p.ensureIndexLoaded(); fail(new Error("temporary read failure"));
		await expect(waiter).resolves.toBeUndefined();
		expect(p.indexer.isFileKnown("note.md")).toBe(true); expect(p.persist).toHaveBeenCalledOnce();
	});
	it("persists initial defaults when data.json has no settings", async () => {
		const { p } = await setup(); p.loadData.mockResolvedValue(null);
		await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		expect(p.saveSettings).toHaveBeenCalledOnce();
	});
	it.each(["config-changed", "obsidian:config-change"])("reacts immediately to %s exclusions updates", async event => {
		const { p, events } = await setup(); p.refreshIndexSmartWithProgress = vi.fn(async () => {});
		await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		p.refreshExcludedMatchers.mockReturnValue(true); events.get(event)!();
		expect(p.refreshIndexSmartWithProgress).toHaveBeenCalledOnce();
	});
	it("waits briefly for the restored active markdown leaf before auto-opening", async () => {
		const { p, events } = await setup(); await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		events.get("layout-ready")!(); expect(p.openEpochView).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300); expect(p.openEpochView).not.toHaveBeenCalled();
		const view: any = new MarkdownView(); view.file = p.files[0]; p.app.workspace.getActiveViewOfType.mockReturnValue(view);
		await vi.advanceTimersByTimeAsync(51); expect(p.openEpochView).toHaveBeenCalledOnce();
	});
	it("does not auto-open after unload", async () => {
		const { p, events, cleanups } = await setup(); await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded();
		events.get("layout-ready")!(); cleanups.forEach(fn => fn());
		await vi.advanceTimersByTimeAsync(1000); expect(p.openEpochView).not.toHaveBeenCalled();
	});
});
