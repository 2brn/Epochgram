import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { persistenceMethods } from "../src/plugin/persistence";
import { pollingMethods } from "../src/plugin/polling";
import { searchMethods } from "../src/plugin/search";
import { scheduleTimelineSearchRebuild } from "../src/plugin/search-rebuild-scheduler";
import { hydrateTimelineSearchIndexFromLoadedState } from "../src/plugin/timeline-search-hydration";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
const matches = (p: any, text: string) => p.timelineSearchIndex.searchFileIds({ includeText: text, exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
	const p = await makeReviewPlugin({ "note.md": "Intro words filling the summary and more words before the body-only uniqueneedle" });
	Object.assign(p, persistenceMethods, pollingMethods, searchMethods);
	const cleanups: Array<() => void> = []; p.register = (fn: () => void) => cleanups.push(fn);
	p.stored.set(p.indexFilePath, JSON.stringify(p.indexer.toJSON()));
	return { p, cleanups };
}
describe("search recovery after startup and sync", () => {
	it("rebuilds a syntactically valid but stale search cache after startup", async () => {
		const { p } = await setup(); const old = new TimelineSearchIndex();
		old.upsert({ id: "note.md", kind: "file", path: "note.md", basename: "note", directory: "", meta: "", content: "staleonly" });
		const serialized = old.serialize(); p.stored.set(`${p.pluginDirPath}/search.json`, typeof serialized === "string" ? serialized : JSON.stringify(serialized));
		expect(await p.initializeIndex()).toBe(true);
		expect(matches(p, "staleonly").has("note.md")).toBe(true);
		await vi.advanceTimersByTimeAsync(2501);
		expect(matches(p, "uniqueneedle").has("note.md")).toBe(true);
		expect(matches(p, "staleonly").size).toBe(0);
	});
	it("keeps body-only matches available during a review-only external reload", async () => {
		const { p } = await setup();
		expect(matches(p, "uniqueneedle").has("note.md")).toBe(true);
		await p.reloadIndexFromDisk();
		expect(matches(p, "uniqueneedle").has("note.md")).toBe(true);
		await vi.advanceTimersByTimeAsync(2501);
		expect(matches(p, "uniqueneedle").has("note.md")).toBe(true);
	});
	it("queues another refresh when Sync arrives during an in-flight rebuild", async () => {
		const { p } = await setup(); let finish!: () => void;
		p.rebuildTimelineSearchIndex = vi.fn(async () => {}).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		scheduleTimelineSearchRebuild(p); await vi.advanceTimersByTimeAsync(2501);
		scheduleTimelineSearchRebuild(p); await vi.advanceTimersByTimeAsync(2501);
		expect(p.rebuildTimelineSearchIndex).toHaveBeenCalledOnce(); finish();
		for (let i = 0; i < 10; i++) await Promise.resolve();
		await vi.advanceTimersByTimeAsync(2501); expect(p.rebuildTimelineSearchIndex).toHaveBeenCalledTimes(2);
	});
	it("waits for an independently started manual rebuild", async () => {
		const { p } = await setup(); p.rebuildTimelineSearchIndex = vi.fn(async () => {}); p.timelineSearchRebuildStartedAt = Date.now();
		scheduleTimelineSearchRebuild(p); await vi.advanceTimersByTimeAsync(2501); expect(p.rebuildTimelineSearchIndex).not.toHaveBeenCalled();
		delete p.timelineSearchRebuildStartedAt; await vi.advanceTimersByTimeAsync(2501); expect(p.rebuildTimelineSearchIndex).toHaveBeenCalledOnce();
	});
	it("does not commit background search rebuilt after plugin unload", async () => {
		const { p, cleanups } = await setup(); const original = p.timelineSearchIndex; let finish!: (value: string) => void;
		p.app.vault.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
		scheduleTimelineSearchRebuild(p); await vi.advanceTimersByTimeAsync(2501);
		p.__epochUnloaded = true; cleanups.forEach(fn => fn()); finish("Post-unload content");
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(p.timelineSearchIndex).toBe(original); expect(p.refreshEpochViews).not.toHaveBeenCalled();
	});
	it("cancels deferred search work on unload", async () => {
		const { p, cleanups } = await setup(); p.rebuildTimelineSearchIndex = vi.fn(async () => {});
		scheduleTimelineSearchRebuild(p); cleanups.forEach(fn => fn());
		await vi.advanceTimersByTimeAsync(2501);
		expect(p.rebuildTimelineSearchIndex).not.toHaveBeenCalled();
	});
	it("handles rejected refreshes without an unhandled rejection", async () => {
		const { p } = await setup(); const error = vi.spyOn(console, "error").mockImplementation(() => {});
		p.rebuildTimelineSearchIndex = vi.fn(async () => { throw new Error("read failure"); });
		scheduleTimelineSearchRebuild(p); await vi.advanceTimersByTimeAsync(2501);
		expect(error).toHaveBeenCalled(); expect(p.__epochSearchRefreshTimer).toBeUndefined();
	});
	it.each(["today", "date", "dock"])("retains %s pin search metadata in fallback hydration", async pin => {
		const p = await makeReviewPlugin({ "note.md": `---\npin: ${pin}\n---\nBody` });
		hydrateTimelineSearchIndexFromLoadedState(p);
		expect(matches(p, "pinned").has("note.md")).toBe(true);
	});
});
