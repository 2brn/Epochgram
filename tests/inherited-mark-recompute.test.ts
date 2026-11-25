import { afterEach, describe, expect, it, vi } from "vitest";
import { inheritedMarkMethods } from "../src/plugin/inherited-marks";
function plugin(): any {
	return Object.assign({ settings: { similarityUseLinks: false, similarityUseTags: false, similarityTitleJwThreshold: 1 }, indexer: { getIndexedPaths: () => ["a.md", "b.md"], getFileMarkColor: (path: string) => path === "a.md" ? 1 : null, getFileMarkHex: () => "" }, refreshEpochViews: vi.fn(), __epochInheritedMarkComputedAt: 0 }, inheritedMarkMethods);
}
afterEach(() => vi.restoreAllMocks());
describe("inherited mark recompute", () => {
	it("invalidates search caches even for recomputations in the same millisecond", async () => {
		vi.spyOn(Date, "now").mockReturnValue(100);
		const p = plugin(); await p.recomputeInheritedMarksNow();
		expect(p.__epochInheritedMarkIndexByPath.get("b.md")).toBe(1);
		const first = p.__epochInheritedMarkComputedAt;
		p.indexer.getFileMarkColor = () => null; await p.recomputeInheritedMarksNow();
		expect(p.__epochInheritedMarkIndexByPath.size).toBe(0);
		expect(p.__epochInheritedMarkComputedAt).toBeGreaterThan(first);
	});
	it("clears maps and invalidates caches if recomputation fails", async () => {
		const p = plugin(); await p.recomputeInheritedMarksNow();
		const first = p.__epochInheritedMarkComputedAt;
		p.indexer.getIndexedPaths = () => { throw new Error("unavailable"); };
		await expect(p.recomputeInheritedMarksNow()).resolves.toBeUndefined();
		expect(p.__epochInheritedMarkIndexByPath.size).toBe(0);
		expect(p.__epochInheritedMarkSourceByPath.size).toBe(0); expect(p.__epochInheritedMarkReasonByPath.size).toBe(0);
		expect(p.__epochInheritedMarkComputedAt).toBeGreaterThan(first);
	});
});
