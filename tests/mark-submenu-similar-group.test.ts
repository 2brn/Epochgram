import { describe, expect, it } from "vitest";
import {
	getMarkCenterPathForGroupActions,
	getSimilarGroupPathsForMarking,
	resolveMarkAncestorPath,
	computeTargetsForMarkMenuAction,
	isPathInheritedMarked
	,resolveMarkGroupAnchorPath
} from "../src/ui/mark-group";
import { withTrustedPro } from "./helpers/trusted-pro";
import { NO_SIMILARITY_MODEL } from "../src/plugin/similarity/config";

describe("getSimilarGroupPathsForMarking", () => {
	it("includes non-md related paths from graph", async () => {
		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 1 },
			getGraphRelatedPathsForFile: async () => new Set(["a.md", "b.png", "epoch://x/2020-01-01-2020-01-02"])
		};
		withTrustedPro(plugin);

		const paths = await getSimilarGroupPathsForMarking(plugin, "a.md");
		expect(paths.has("a.md")).toBe(true);
		expect(paths.has("b.png")).toBe(true);
		expect(Array.from(paths).some((p) => p.startsWith("epoch://"))).toBe(false);
	});

	it("prefers semantic related paths when vectors enabled", async () => {
		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 0.2 },
			getSemanticRelatedPathsForFile: async () => new Set(["b.pdf"]),
			getGraphRelatedPathsForFile: async () => new Set(["c.png"])
		};
		withTrustedPro(plugin);

		const paths = await getSimilarGroupPathsForMarking(plugin, "a.md");
		expect(paths.has("a.md")).toBe(true);
		expect(paths.has("b.pdf")).toBe(true);
		expect(paths.has("c.png")).toBe(false);
	});

	it("falls back to graph when embedding model is none", async () => {
		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 0.2, similarityEmbeddingModelId: NO_SIMILARITY_MODEL },
			getSemanticRelatedPathsForFile: async () => new Set(["b.pdf"]),
			getGraphRelatedPathsForFile: async () => new Set(["c.png"])
		};
		withTrustedPro(plugin);

		const paths = await getSimilarGroupPathsForMarking(plugin, "a.md");
		expect(paths.has("a.md")).toBe(true);
		expect(paths.has("c.png")).toBe(true);
		expect(paths.has("b.pdf")).toBe(false);
	});

	it("returns empty for epoch paths", async () => {
		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 1 },
			getGraphRelatedPathsForFile: async () => new Set(["a.md"])
		};
		withTrustedPro(plugin);

		const paths = await getSimilarGroupPathsForMarking(plugin, "epoch://x/2020-01-01-2020-01-02");
		expect(paths.size).toBe(0);
	});
});

describe("getMarkCenterPathForGroupActions", () => {
	it("prefers inherited source when entry is not explicitly marked", () => {
		const indexer: any = {
			getFileMarkColor: () => null
		};
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", "seed.md")).toBe("seed.md");
	});

	it("keeps entry path when it is explicitly marked", () => {
		const indexer: any = {
			getFileMarkColor: () => 2
		};
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", "seed.md")).toBe("a.md");
	});

	it("keeps entry path when there is no inherited source", () => {
		const indexer: any = {
			getFileMarkColor: () => null
		};
		expect(getMarkCenterPathForGroupActions(indexer, "a.md", null)).toBe("a.md");
	});
});

describe("resolveMarkAncestorPath", () => {
	it("returns entry when explicitly marked", async () => {
		const indexer: any = { getFileMarkColor: () => 1 };
		const plugin: any = { hasProAccess: () => true };
		withTrustedPro(plugin);
		await expect(resolveMarkAncestorPath(plugin, indexer, "a.md", null)).resolves.toBe("a.md");
	});

	it("uses provided inherited source when entry not explicitly marked", async () => {
		const indexer: any = { getFileMarkColor: () => null };
		const plugin: any = { hasProAccess: () => true };
		withTrustedPro(plugin);
		await expect(resolveMarkAncestorPath(plugin, indexer, "a.md", "seed.md")).resolves.toBe("seed.md");
	});

	it("falls back to semantic scored marked path", async () => {
		const indexer: any = {
			getFileMarkColor: (p: string) => (p === "seed.md" ? 2 : null)
		};
		const plugin: any = {
			hasProAccess: () => true,
			getSemanticRelatedScoredForFile: async () => [{ path: "x.md", score: 0.9 }, { path: "seed.md", score: 0.8 }]
		};
		withTrustedPro(plugin);
		await expect(resolveMarkAncestorPath(plugin, indexer, "a.md", null)).resolves.toBe("seed.md");
	});
});

describe("resolveMarkGroupAnchorPath", () => {
	it("chooses anchor whose group covers most same-colored marks", async () => {
		const idxByPath: Record<string, number | null> = {
			"seed.md": 1,
			"a.md": 1,
			"b.md": 1,
			"c.md": 1
		};
		const indexer: any = {
			getFileMarkColor: (p: string) => (p in idxByPath ? idxByPath[p] : null)
		};
		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 1 },
			getGraphRelatedPathsForFile: async (p: string) => {
				if (p === "seed.md") return new Set(["seed.md", "a.md", "b.md", "c.md"]);
				if (p === "a.md") return new Set(["a.md", "seed.md"]);
				return new Set([p]);
			}
		};
		withTrustedPro(plugin);

		await expect(
			resolveMarkGroupAnchorPath(plugin, indexer, "a.md", { targetColorIndex: 1 })
		).resolves.toBe("seed.md");
	});
});

describe("mark submenu target selection", () => {
	it("recolor/clear on inherited item targets only the ancestor even if another file is active", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>([
				["A.md", "Seed.md"],
				["X.md", "Seed.md"],
				["Y.md", "Seed.md"]
			]),
			__epochInheritedMarkReasonByPath: new Map<string, string>([
				["A.md", "link"],
				["X.md", "link"],
				["Y.md", "tag"]
			])
		};
		const indexer: any = { getFileMarkColor: () => null };

		const isEntryInherited = isPathInheritedMarked(plugin, indexer, "A.md");
		expect(isEntryInherited).toBe(true);

		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "A.md",
			resolvedAncestorPath: "Seed.md",
			isEntryInherited,
			isEntryExplicit: false,
			isEntrySimilarToActive: false,
			currentColorIndex: 2,
			nextColorIndex: 3,
			activeFilePath: "Other.md",
			isActiveFileInherited: false
		});

		expect(targets.has("Seed.md")).toBe(true);
		expect(Array.from(targets)).toEqual(["Seed.md"]);
	});

	it("clear on inherited item targets only the ancestor even if current color is unknown", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>([
				["A.md", "Seed.md"],
				["X.md", "Seed.md"],
				["Y.md", "Seed.md"]
			]),
			__epochInheritedMarkReasonByPath: new Map<string, string>([
				["A.md", "link"],
				["X.md", "link"],
				["Y.md", "tag"]
			])
		};
		const indexer: any = { getFileMarkColor: () => null };

		const isEntryInherited = isPathInheritedMarked(plugin, indexer, "A.md");
		expect(isEntryInherited).toBe(true);

		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "A.md",
			resolvedAncestorPath: "Seed.md",
			isEntryInherited,
			isEntryExplicit: false,
			isEntrySimilarToActive: false,
			currentColorIndex: null,
			nextColorIndex: null,
			activeFilePath: "Other.md",
			isActiveFileInherited: false
		});

		expect(targets.has("Seed.md")).toBe(true);
		expect(Array.from(targets)).toEqual(["Seed.md"]);
	});

	it("when active file is inherited-marked, marking a similar item marks the active file (promote to seed)", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>([["Active.md", "Seed.md"]]),
			__epochInheritedMarkReasonByPath: new Map<string, string>([["Active.md", "embedding"]])
		};
		const indexer: any = { getFileMarkColor: () => null };
		const isActiveInherited = isPathInheritedMarked(plugin, indexer, "Active.md");
		expect(isActiveInherited).toBe(true);

		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "B.md",
			resolvedAncestorPath: "SeedB.md",
			isEntryInherited: false,
			isEntryExplicit: false,
			isEntrySimilarToActive: true,
			currentColorIndex: null,
			nextColorIndex: 1,
			activeFilePath: "Active.md",
			isActiveFileInherited: isActiveInherited
		});

		expect(Array.from(targets)).toEqual(["Active.md"]);
	});

	it("when entry is similar to active and active is not inherited-marked, marking marks the active file", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>(),
			__epochInheritedMarkReasonByPath: new Map<string, string>()
		};
		const indexer: any = { getFileMarkColor: () => null };
		const isActiveInherited = isPathInheritedMarked(plugin, indexer, "Active.md");
		expect(isActiveInherited).toBe(false);

		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "B.md",
			resolvedAncestorPath: "SeedB.md",
			isEntryInherited: false,
			isEntryExplicit: false,
			isEntrySimilarToActive: true,
			currentColorIndex: null,
			nextColorIndex: 1,
			activeFilePath: "Active.md",
			isActiveFileInherited: isActiveInherited
		});
		expect(Array.from(targets)).toEqual(["Active.md"]);
	});

	it("when entry is not similar to active, changing color makes the clicked entry the ancestor", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>(),
			__epochInheritedMarkReasonByPath: new Map<string, string>()
		};
		const indexer: any = { getFileMarkColor: () => null };
		const isActiveInherited = isPathInheritedMarked(plugin, indexer, "Active.md");
		expect(isActiveInherited).toBe(false);

		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "B.md",
			resolvedAncestorPath: "SeedB.md",
			isEntryInherited: false,
			isEntryExplicit: false,
			isEntrySimilarToActive: false,
			currentColorIndex: null,
			nextColorIndex: 1,
			activeFilePath: "Active.md",
			isActiveFileInherited: isActiveInherited
		});
		expect(Array.from(targets)).toEqual(["B.md"]);
	});

	it("explicitly marked entries are always their own target", () => {
		const plugin: any = {
			__epochInheritedMarkSourceByPath: new Map<string, string>([["A.md", "Seed.md"]]),
			__epochInheritedMarkReasonByPath: new Map<string, string>([["A.md", "link"]])
		};
		const targets = computeTargetsForMarkMenuAction(plugin, {
			entryPath: "A.md",
			resolvedAncestorPath: "Seed.md",
			isEntryInherited: false,
			isEntryExplicit: true,
			isEntrySimilarToActive: true,
			currentColorIndex: 2,
			nextColorIndex: 3,
			activeFilePath: "Active.md",
			isActiveFileInherited: false
		});
		expect(Array.from(targets)).toEqual(["A.md"]);
	});
});
