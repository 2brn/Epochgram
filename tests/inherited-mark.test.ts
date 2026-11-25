import { describe, expect, it } from "vitest";
import { computeInheritedMarkData } from "../src/ui/inherited-mark";
describe("inherited marks", () => {
	it("matches similar titles even when the seed is not visible", () => {
		const data = computeInheritedMarkData({ visiblePaths: ["Diary - Albania (copy).md"], seedPaths: ["Diary - Albania.md"], getFileMarkColor: path => path === "Diary - Albania.md" ? 2 : null, titleJwThreshold: 0.8 });
		expect(data?.indexByPath.get("Diary - Albania (copy).md")).toBe(2);
	});
	it("disables title matching at zero", () => {
		expect(computeInheritedMarkData({ visiblePaths: ["copy.md"], seedPaths: ["seed.md"], getFileMarkColor: path => path === "seed.md" ? 2 : null, titleJwThreshold: 0 })).toBeNull();
	});
	it("matches same-folder files at threshold one", () => {
		const data = computeInheritedMarkData({ visiblePaths: ["journal/Other.md", "elsewhere/Other.md"], seedPaths: ["journal/Seed.md"], getFileMarkColor: path => path.endsWith("Seed.md") ? 3 : null, titleJwThreshold: 1 });
		expect(data?.indexByPath.get("journal/Other.md")).toBe(3);
		expect(data?.indexByPath.has("elsewhere/Other.md")).toBe(false);
	});
	it("prioritizes links over tags and tags over titles", () => {
		const base = { visiblePaths: ["target.md"], seedPaths: ["link.md", "tag.md", "title.md"], getFileMarkColor: (path: string) => ({ "link.md": 1, "tag.md": 2, "title.md": 3 })[path] ?? null, titleJwThreshold: 1, tagCandidatesBySeedPath: new Map([["tag.md", [{ path: "target.md" }]]]) };
		const linked = computeInheritedMarkData({ ...base, linkCandidatesBySeedPath: new Map([["link.md", [{ path: "target.md" }]]]) });
		expect(linked?.indexByPath.get("target.md")).toBe(1); expect(linked?.reasonByPath.get("target.md")).toBe("link");
		expect(computeInheritedMarkData(base)?.indexByPath.get("target.md")).toBe(2);
	});
	it("uses strongest scores then deterministic seed-path ties", () => {
		const base = { visiblePaths: ["x.md"], seedPaths: ["b.md", "a.md"], getFileMarkColor: (path: string) => path === "a.md" ? 1 : path === "b.md" ? 2 : null, titleJwThreshold: 0 };
		expect(computeInheritedMarkData({ ...base, linkCandidatesBySeedPath: new Map([["a.md", [{ path: "x.md", score: 0.8 }]], ["b.md", [{ path: "x.md", score: 0.9 }]]]) })?.sourceByPath.get("x.md")).toBe("b.md");
		expect(computeInheritedMarkData({ ...base, linkCandidatesBySeedPath: new Map([["b.md", [{ path: "x.md" }]], ["a.md", [{ path: "x.md" }]]]) })?.sourceByPath.get("x.md")).toBe("a.md");
	});
	it("never overrides explicit marks and respects symmetric signal masks", () => {
		const data = computeInheritedMarkData({ visiblePaths: ["explicit.md", "blocked.md"], seedPaths: ["seed.md"], getFileMarkColor: path => path === "explicit.md" ? 4 : path === "seed.md" ? 1 : null, titleJwThreshold: 1, canMatch: (_seed, candidate) => candidate !== "blocked.md" });
		expect(data?.indexByPath.get("explicit.md")).toBe(4); expect(data?.sourceByPath.has("explicit.md")).toBe(false); expect(data?.indexByPath.has("blocked.md")).toBe(false);
	});
});
