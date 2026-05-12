import { describe, expect, it, vi } from "vitest";
import { inheritedMarkMethods } from "../src/plugin/inherited-marks";

describe("inherited marks - epoch votes", () => {
	it("excludes synthetic pinned-today entries from epoch child-record votes", async () => {
		const today = "2026-02-26";
		const epochPath = `epoch://day/${today}-${today}`;

		const index: any = {
			[today]: [
				{
					file: "A.md",
					date: today,
					source: "dateProp",
					aiSummary: "Child summary",
					blockStart: 0,
					blockEnd: 0,
					pinned: true,
					originalDate: "2026-01-17"
				},
				{ file: epochPath, date: today, source: "epoch" }
			]
		};

		const indexer: any = {
			index,
			toJSON: () => ({ files: { "A.md": { markColor: 1 } } }),
			getIndexedPaths: () => ["A.md"],
			getFileEmbeddingTerm: () => "",
			getFileMarkColor: (p: string) => (p === "A.md" ? 1 : null)
		};

		const plugin: any = {
			indexer,
			settings: {
				similarityThreshold: 0,
				similarityZeroShotMinScore: 0
			},
			hasProAccess: () => true,
			refreshEpochViews: vi.fn(),
			clearInheritedMarksCache: vi.fn()
		};

		await inheritedMarkMethods.recomputeInheritedMarksNow.call(plugin, "test");

		const inherited: Map<string, number> | null = plugin.__epochInheritedMarkIndexByPath ?? null;
		expect(inherited).toBeTruthy();
		expect(inherited!.get("A.md")).toBe(1);
		// The epoch should NOT inherit from the synthetic pinned-today clone.
		expect(inherited!.has(epochPath)).toBe(false);
	});
});
