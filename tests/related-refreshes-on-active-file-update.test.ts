import { describe, expect, it, vi } from "vitest";
import { refreshRelatedForActiveFile } from "../src/ui/epoch-canvas/related";
function canvas(): any {
	return { activeFilePath: "A.md", relatedRequestId: 0, __indexVersion: 1, draw: vi.fn(), plugin: { settings: { similarityUseLinks: true, similarityUseTags: true, similarityTitleJwThreshold: 0.9 }, getRelatedScoredForFile: vi.fn(async () => [{ path: "B.md", score: 0.9 }]) } };
}
describe("related highlights", () => {
	it("refreshes after reindexing and caches unchanged state", async () => {
		const c = canvas();
		refreshRelatedForActiveFile(c); await Promise.resolve();
		expect(c.relatedPaths).toEqual(new Set(["B.md"]));
		c.__indexVersion++;
		refreshRelatedForActiveFile(c); await Promise.resolve();
		refreshRelatedForActiveFile(c);
		expect(c.plugin.getRelatedScoredForFile).toHaveBeenCalledTimes(2);
	});
	it("discards stale async results when active files change", async () => {
		const c = canvas();
		let finish!: (items: Array<{ path: string; score: number }>) => void;
		c.plugin.getRelatedScoredForFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		refreshRelatedForActiveFile(c);
		c.activeFilePath = "C.md";
		refreshRelatedForActiveFile(c); await Promise.resolve();
		finish([{ path: "old.md", score: 1 }]); await Promise.resolve();
		expect(c.relatedPaths).toEqual(new Set(["B.md"]));
	});
	it("clears highlights when no file is active", async () => {
		const c = canvas(); refreshRelatedForActiveFile(c); await Promise.resolve();
		c.activeFilePath = null; refreshRelatedForActiveFile(c);
		expect(c.relatedPaths).toBeNull(); expect(c.relatedScored).toBeNull();
	});
});
