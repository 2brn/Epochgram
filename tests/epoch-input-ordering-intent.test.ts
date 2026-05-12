import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Epoch input ordering (intent-weighted)", () => {
	it("prefers pinned-in-period groups over higher-record-count groups", async () => {
		const fileA = "A/Many records.md";
		const fileB = "B/Pinned but fewer.md";
		const plugin: any = {
			indexer: {
				index: {
					"2026-02-11": [
						{ date: "2026-02-11", file: fileA, source: "tracked", trackedChange: "modified", summary: "A1", blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-11", file: fileA, source: "tracked", trackedChange: "modified", summary: "A2", blockStart: 1, blockEnd: 2 },
						{ date: "2026-02-11", file: fileA, source: "tracked", trackedChange: "modified", summary: "A3", blockStart: 3, blockEnd: 4 },
						{ date: "2026-02-11", file: fileB, source: "tracked", trackedChange: "added", summary: "B1", pinned: true, blockStart: 0, blockEnd: 0 }
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-11"], "force", ["week"] as any);
		expect(jobs.length).toBeGreaterThan(0);

		const input = String((jobs[0] as any).input || "");
		const aPos = input.indexOf(`${fileA}:`);
		const bPos = input.indexOf(`${fileB}:`);
		expect(aPos).toBeGreaterThanOrEqual(0);
		expect(bPos).toBeGreaterThanOrEqual(0);
		expect(bPos).toBeLessThan(aPos);
	});

	it("round-robins across topic groups for diversity", async () => {
		const f1 = "T1/Top.md";
		const f2 = "T1/Second.md";
		const f3 = "T2/Top.md";
		const f4 = "T2/Second.md";

		const plugin: any = {
			indexer: {
				getFileEmbeddingTerm: (path: string) => {
					if (path.startsWith("T1/")) return "topic:alpha";
					if (path.startsWith("T2/")) return "topic:beta";
					return "";
				},
				index: {
					"2026-02-11": [
						{ date: "2026-02-11", file: f1, source: "tracked", trackedChange: "modified", summary: "f1", blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-11", file: f1, source: "tracked", trackedChange: "modified", summary: "f1b", blockStart: 1, blockEnd: 2 },
						{ date: "2026-02-11", file: f2, source: "tracked", trackedChange: "modified", summary: "f2", blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-11", file: f3, source: "tracked", trackedChange: "modified", summary: "f3", blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-11", file: f3, source: "tracked", trackedChange: "modified", summary: "f3b", blockStart: 1, blockEnd: 2 },
						{ date: "2026-02-11", file: f4, source: "tracked", trackedChange: "modified", summary: "f4", blockStart: 0, blockEnd: 0 }
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-11"], "force", ["week"] as any);
		expect(jobs.length).toBeGreaterThan(0);

		const input = String((jobs[0] as any).input || "");
		const p1 = input.indexOf(`${f1}:`);
		const p2 = input.indexOf(`${f2}:`);
		const p3 = input.indexOf(`${f3}:`);
		const p4 = input.indexOf(`${f4}:`);
		expect(p1).toBeGreaterThanOrEqual(0);
		expect(p2).toBeGreaterThanOrEqual(0);
		expect(p3).toBeGreaterThanOrEqual(0);
		expect(p4).toBeGreaterThanOrEqual(0);

		// Diversity-first: interleave the first item from each topic group.
		expect(p1).toBeLessThan(p3);
		expect(p3).toBeLessThan(p2);
		expect(p2).toBeLessThan(p4);
	});
});
