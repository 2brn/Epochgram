import { describe, expect, it, vi } from "vitest";
import { runRebuild } from "../src/plugin/maintenance-rebuild";
describe("maintenance rebuild ordering", () => {
	it("rebuilds records before the search index", async () => {
		const calls: string[] = [];
		const plugin: any = { rebuildIndexWithProgress: vi.fn(async () => { calls.push("index"); }), rebuildTimelineSearchIndex: vi.fn(async () => { calls.push("search"); }) };
		await runRebuild(plugin, { index: true, search: true });
		expect(calls).toEqual(["index", "search"]);
	});
	it("can rebuild search alone", async () => {
		const plugin: any = { rebuildIndexWithProgress: vi.fn(), rebuildTimelineSearchIndex: vi.fn(async () => {}) };
		await runRebuild(plugin, { index: false, search: true });
		expect(plugin.rebuildIndexWithProgress).not.toHaveBeenCalled();
		expect(plugin.rebuildTimelineSearchIndex).toHaveBeenCalledOnce();
	});
});
