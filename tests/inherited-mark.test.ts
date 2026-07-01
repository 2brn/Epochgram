import { describe, expect, it } from "vitest";
import { computeInheritedMarkData } from "../src/ui/inherited-mark";
import { buildTopicCandidatesFromSeeds } from "../src/plugin/inherited-marks";

const files = (vectors: Record<string, number[]>) => {
	const out: Record<string, { v: number[] }> = {};
	for (const [k, v] of Object.entries(vectors)) out[k] = { v };
	return out;
};

describe("computeInheritedMarkData", () => {
	it("expands from marked seeds", () => {
		const storeFiles = files({
			"a.md": [1, 0],
			"b.md": [0.99, 0.01],
			"c.md": [0.98, 0.02],
			"z.md": [0, 1]
		});
		const getFileMarkColor = (p: string) => (p === "a.md" ? 1 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["a.md", "b.md", "c.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("b.md")).toBe(1);
		expect(data!.indexByPath.get("c.md")).toBe(1);
	});

	it("does not apply vector/title threshold to epoch:// candidates", () => {
		// Epoch entries should NOT use vector/title threshold; instead they inherit from
		// marked child records by vote: most records wins, tie-break by total charCount.
		const storeFiles = files({
			"a.md": [1, 0],
			"b.md": [0.99, 0.01],
			"epoch://month/2025-01-01-2025-01-31": [0.8, 0.2]
		});
		const getFileMarkColor = (p: string) => {
			if (p === "a.md") return 1;
			if (p === "child-1.md") return 2;
			if (p === "child-2.md") return 2;
			if (p === "child-3.md") return 1;
			return null;
		};
		const data = computeInheritedMarkData({
			visiblePaths: [
				"a.md",
				"b.md",
				"child-1.md",
				"child-2.md",
				"child-3.md",
				"epoch://month/2025-01-01-2025-01-31"
			],
			storeFiles,
			getFileMarkColor,
			getEpochChildRecords: (epochPath: string) => {
				if (epochPath !== "epoch://month/2025-01-01-2025-01-31") return [];
				return [
					{ path: "child-1.md", lineCount: 10 },
					{ path: "child-2.md", lineCount: 3 },
					{ path: "child-3.md", lineCount: 100 }
				];
			},
			threshold: 0.7
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("b.md")).toBe(1);
		// Color 2 wins on record count (2 vs 1), despite child-3 having lots of lines.
		expect(data!.indexByPath.get("epoch://month/2025-01-01-2025-01-31")).toBe(2);
	});

	it("can expand from marked seeds outside visiblePaths", () => {
		const storeFiles = files({
			"seed.md": [1, 0],
			"cand.md": [0.9, 0.1],
			"other.md": [0, 1]
		});
		const getFileMarkColor = (p: string) => (p === "seed.md" ? 4 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["cand.md"],
			seedPaths: ["seed.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("cand.md")).toBe(4);
	});

	it("can inherit by title threshold (Jaro–Winkler) even without vectors", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => (p === "Diary - Albania.md" ? 2 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["Diary - Albania (copy).md"],
			seedPaths: ["Diary - Albania.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("Diary - Albania (copy).md")).toBe(2);
	});

	it("can disable title threshold via threshold=0", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => (p === "Diary - Albania.md" ? 2 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["Diary - Albania (copy).md"],
			seedPaths: ["Diary - Albania.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5,
			titleJwThreshold: 0
		});
		expect(data).toBeNull();
	});

	it("treats title threshold 1.0 as same-folder matching", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => (p === "journal/Alpha.md" ? 3 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["journal/Completely Different Name.md", "other/Completely Different Name.md"],
			seedPaths: ["journal/Alpha.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5,
			titleJwThreshold: 1
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("journal/Completely Different Name.md")).toBe(3);
		expect(data!.indexByPath.has("other/Completely Different Name.md")).toBe(false);
	});

	it("treats 'Epoch - To Do' and 'Epoch - LLC' as title-similar", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => (p === "Epoch - To Do.md" ? 1 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["Epoch - LLC.md"],
			seedPaths: ["Epoch - To Do.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("Epoch - LLC.md")).toBe(1);
	});

	it("chooses the marked color by the best similarity coefficient", () => {
		const storeFiles = files({
			"red.md": [1, 0],
			"orange.md": [0, 1],
			"x.md": [0.2, 0.8],
			"y.md": [0.9, 0.1]
		});
		const getFileMarkColor = (p: string) => {
			if (p === "red.md") return 1;
			if (p === "orange.md") return 2;
			return null;
		};

		const data = computeInheritedMarkData({
			visiblePaths: ["red.md", "orange.md", "x.md", "y.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.0001
		});
		expect(data).not.toBeNull();

		// x.md is closer to orange.md => inherits 2
		expect(data!.indexByPath.get("x.md")).toBe(2);
		// y.md is closer to red.md => inherits 1
		expect(data!.indexByPath.get("y.md")).toBe(1);
	});

	it("respects threshold and does not assign below it", () => {
		const storeFiles = files({
			"seed.md": [1, 0],
			"near.md": [0.6, 0.4],
			"far.md": [0.1, 0.9]
		});
		const getFileMarkColor = (p: string) => (p === "seed.md" ? 3 : null);
		const data = computeInheritedMarkData({
			visiblePaths: ["seed.md", "near.md", "far.md"],
			storeFiles,
			getFileMarkColor,
			threshold: 0.5
		});
		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("near.md")).toBe(3);
		expect(data!.indexByPath.has("far.md")).toBe(false);
	});

	it("prioritizes link candidates over embedding similarity", () => {
		const storeFiles = files({
			"seed-link.md": [1, 0],
			"seed-embed.md": [0, 1],
			"cand.md": [0, 1]
		});
		const getFileMarkColor = (p: string) => {
			if (p === "seed-link.md") return 1;
			if (p === "seed-embed.md") return 2;
			return null;
		};

		const data = computeInheritedMarkData({
			visiblePaths: ["seed-link.md", "seed-embed.md", "cand.md"],
			storeFiles,
			getFileMarkColor,
			linkCandidatesBySeedPath: new Map([
				["seed-link.md", [{ path: "cand.md" }]]
			]),
			threshold: 0.5
		});

		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("cand.md")).toBe(1);
		expect(data!.sourceByPath.get("cand.md")).toBe("seed-link.md");
		expect(data!.reasonByPath?.get("cand.md")).toBe("link");
	});

	it("prioritizes tag candidates over title similarity", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => {
			if (p === "Diary - Albania.md") return 1;
			if (p === "Tagged seed.md") return 2;
			return null;
		};

		const data = computeInheritedMarkData({
			visiblePaths: ["Diary - Albania (copy).md"],
			seedPaths: ["Diary - Albania.md", "Tagged seed.md"],
			storeFiles,
			getFileMarkColor,
			tagCandidatesBySeedPath: new Map([
				["Tagged seed.md", [{ path: "Diary - Albania (copy).md" }]]
			]),
			threshold: 0.5
		});

		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("Diary - Albania (copy).md")).toBe(2);
		expect(data!.sourceByPath.get("Diary - Albania (copy).md")).toBe("Tagged seed.md");
		expect(data!.reasonByPath?.get("Diary - Albania (copy).md")).toBe("tag");
	});

	it("breaks ties deterministically by seed path", () => {
		const storeFiles = files({});
		const getFileMarkColor = (p: string) => {
			if (p === "a.md") return 1;
			if (p === "b.md") return 2;
			return null;
		};
		const data = computeInheritedMarkData({
			visiblePaths: ["x.md"],
			seedPaths: ["a.md", "b.md"],
			storeFiles,
			getFileMarkColor,
			linkCandidatesBySeedPath: new Map([
				["b.md", [{ path: "x.md" }]],
				["a.md", [{ path: "x.md" }]]
			]),
			threshold: 0.5
		});

		expect(data).not.toBeNull();
		expect(data!.indexByPath.get("x.md")).toBe(1);
		expect(data!.sourceByPath.get("x.md")).toBe("a.md");
		expect(data!.reasonByPath?.get("x.md")).toBe("link");
	});

	it("uses computed topic to expand when seed lacks explicit topic", () => {
		const indexer = {
			getIndexedPaths: () => ["seed.md", "other.md"],
			getFileEmbeddingTerm: (p: string) => (p === "other.md" ? "alpha" : "")
		};
		const termStoreFiles = {
			"seed.md": { term: "alpha", score: 0.9, vocabularySig: "sig" },
			"other.md": { term: "alpha", score: 0.8, vocabularySig: "sig" }
		};
		const res = buildTopicCandidatesFromSeeds({
			seedPaths: ["seed.md"],
			indexer,
			termStoreFiles,
			zeroShotMinScore: 0.5,
			vocabularySig: "sig",
			visibleSet: new Set(["seed.md", "other.md"])
		});
		const cand = res.get("seed.md") ?? [];
		expect(cand.length).toBe(1);
		expect(cand[0].path).toBe("other.md");
		expect(cand[0].score).toBeGreaterThanOrEqual(0.8);
	});

	it("treats '!topic' and '#topic' as normal explicit terms", () => {
		const indexer = {
			getIndexedPaths: () => ["seed1.md", "seed2.md", "other.md"],
			getFileEmbeddingTerm: (p: string) => {
				if (p === "seed1.md") return "!alpha";
				if (p === "seed2.md") return "#beta";
				if (p === "other.md") return "!alpha";
				return "";
			}
		};
		const termStoreFiles = {
			"seed1.md": { term: "alpha", score: 0.9, vocabularySig: "sig" },
			"seed2.md": { term: "beta", score: 0.9, vocabularySig: "sig" },
			"other.md": { term: "alpha", score: 0.9, vocabularySig: "sig" }
		};
		const res = buildTopicCandidatesFromSeeds({
			seedPaths: ["seed1.md", "seed2.md"],
			indexer,
			termStoreFiles,
			zeroShotMinScore: 0.5,
			vocabularySig: "sig",
			visibleSet: new Set(["seed1.md", "seed2.md", "other.md"])
		});
		const cand1 = res.get("seed1.md") ?? [];
		expect(cand1).toEqual([{ path: "other.md", score: 1 }]);
		const cand2 = res.get("seed2.md") ?? [];
		expect(cand2.length).toBe(0);
	});
});
