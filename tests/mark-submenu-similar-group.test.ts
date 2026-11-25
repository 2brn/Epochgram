import { describe, expect, it } from "vitest";
import { getMarkCenterPathForGroupActions, getSimilarGroupPathsForMarking, resolveMarkAncestorPath, computeTargetsForMarkMenuAction, isPathInheritedMarked, resolveMarkGroupAnchorPath } from "../src/ui/mark-group";
describe("mark groups", () => {
	it("includes related attachments", async () => {
		expect(await getSimilarGroupPathsForMarking({ getGraphRelatedPathsForFile: async () => new Set(["a.md", "b.png"]) }, "a.md")).toEqual(new Set(["a.md", "b.png"]));
	});
	it("prefers explicit marks over inherited sources", async () => {
		const indexer = { getFileMarkColor: () => 2 };
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", "seed.md")).toBe("a.md");
		expect(await resolveMarkAncestorPath({}, indexer, "a.md", "seed.md")).toBe("a.md");
	});
	it("uses inherited sources or resolves a marked graph neighbor", async () => {
		const indexer = { getFileMarkColor: (path: string) => path === "seed.md" ? 2 : null };
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", "seed.md")).toBe("seed.md");
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", null)).toBe("a.md");
		expect(await resolveMarkAncestorPath({}, indexer, "a.md", "seed.md")).toBe("seed.md");
		expect(await resolveMarkAncestorPath({ getGraphRelatedPathsForFile: async () => new Set(["x.md", "seed.md"]) }, indexer, "a.md")).toBe("seed.md");
	});
	it("chooses the anchor covering the most same-colored marks", async () => {
		const indexer = { getFileMarkColor: () => 1 };
		const plugin = { getGraphRelatedPathsForFile: async (path: string) => new Set(path === "seed.md" ? ["seed.md", "a.md", "b.md", "c.md"] : path === "a.md" ? ["a.md", "seed.md"] : [path]) };
		expect(await resolveMarkGroupAnchorPath(plugin, indexer, "a.md", { targetColorIndex: 1 })).toBe("seed.md");
	});
	it.each([
		[{ isEntryInherited: true, currentColorIndex: 2, nextColorIndex: 3 }, "Seed.md"],
		[{ isEntryInherited: true, currentColorIndex: null, nextColorIndex: null }, "Seed.md"],
		[{ isEntrySimilarToActive: true, isActiveFileInherited: true }, "Active.md"],
		[{ isEntrySimilarToActive: true }, "Active.md"],
		[{ isEntrySimilarToActive: false }, "A.md"],
		[{ isEntryExplicit: true, isEntrySimilarToActive: true }, "A.md"]
	])("selects the correct mark target: %j", (overrides, expected) => {
		const args = { entryPath: "A.md", resolvedAncestorPath: "Seed.md", isEntryInherited: false, isEntryExplicit: false, isEntrySimilarToActive: false, currentColorIndex: null, nextColorIndex: 1, activeFilePath: "Active.md", isActiveFileInherited: false, ...overrides };
		expect([...computeTargetsForMarkMenuAction({}, args)]).toEqual([expected]);
	});
	it("recognizes inherited marks without treating explicit marks as inherited", () => {
		const plugin = { __epochInheritedMarkSourceByPath: new Map([["A.md", "Seed.md"]]) };
		expect(isPathInheritedMarked(plugin, { getFileMarkColor: () => null }, "A.md")).toBe(true);
		expect(isPathInheritedMarked(plugin, { getFileMarkColor: () => 2 }, "A.md")).toBe(false);
	});
});
