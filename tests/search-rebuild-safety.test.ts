import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { searchMethods } from "../src/plugin/search";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
function plugin(): any {
	const files = ["a.md", "b.md"].map(path => new (TFile as any)(path, { basename: path.slice(0, -3), extension: "md" }));
	const p: any = {
		timelineSearchIndex: new TimelineSearchIndex(), indexReady: true, settings: {},
		indexer: { getIndexedPaths: () => files.map(file => file.path), getFileIndexData: () => ({ pinnedFile: "dock" }) },
		ensureIndexLoaded: vi.fn(async () => {}), waitForExcludedSync: vi.fn(async () => {}), shouldIndexFile: () => true, refreshEpochViews: vi.fn(),
		app: { vault: { configDir: "config", getAbstractFileByPath: (path: string) => files.find(file => file.path === path), read: vi.fn(async () => "fresh content"), adapter: { exists: vi.fn(async () => false), write: vi.fn(async () => {}) } }, metadataCache: { getFileCache: () => null } }
	};
	p.timelineSearchIndex.upsert({ id: "original.md", kind: "file", path: "original.md", basename: "original", directory: "", content: "original content", meta: "" });
	return p;
}
const search = (index: TimelineSearchIndex, text: string) => index.searchFileIds({ includeText: text, exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
describe("search rebuild safety", () => {
	it("keeps the old searchable index when canceled while reading the last file", async () => {
		const p = plugin(), previous = p.timelineSearchIndex;
		p.app.vault.read.mockImplementation(async (file: TFile) => {
			if (file.path === "b.md") p.__epochCancelRequestedAt = { search: Date.now() };
			return "fresh content";
		});
		await expect(searchMethods.rebuildTimelineSearchIndex.call(p)).resolves.toBeUndefined();
		expect(p.timelineSearchIndex).toBe(previous); expect(search(previous, "original")).toEqual(new Set(["original.md"]));
		expect(p.app.vault.adapter.write).not.toHaveBeenCalled();
	});
	it("does not replace an intervening edit or reset", async () => {
		const p = plugin(), previous = p.timelineSearchIndex;
		p.app.vault.read.mockImplementation(async () => { p.__timelineSearchIndexVersion = 1; return "fresh content"; });
		await searchMethods.rebuildTimelineSearchIndex.call(p);
		expect(p.timelineSearchIndex).toBe(previous); expect(p.app.vault.adapter.write).not.toHaveBeenCalled();
	});
	it("swaps in completed search results and retains pin metadata", async () => {
		const p = plugin(), previous = p.timelineSearchIndex;
		await searchMethods.rebuildTimelineSearchIndex.call(p);
		expect(p.timelineSearchIndex).not.toBe(previous);
		expect(search(p.timelineSearchIndex, "fresh")).toEqual(new Set(["a.md", "b.md"]));
		expect(search(p.timelineSearchIndex, "pinned")).toEqual(new Set(["a.md", "b.md"]));
		expect(search(p.timelineSearchIndex, "original").size).toBe(0);
		expect(p.app.vault.adapter.write).toHaveBeenCalledOnce();
	});
});
