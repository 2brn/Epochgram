import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Epoch top bucket generation", () => {
	it("generates the year bucket when there are text records in the year range", async () => {
		const plugin: any = {
			indexer: {
				index: {
					// Simulate a day that currently contains only an already-generated epoch entry.
					"2026-02-10": [
						{ date: "2026-02-10", file: "epoch://month/2026-02-01-2026-02-29", summary: "", source: "epoch", epochBucket: "month", epochStart: "2026-02-01", epochEnd: "2026-02-29" }
					]
				},
				files: {
					"note.md": {
						cdate: null,
						namedDate: null,
						contentDates: [
							{ date: "2026-03-01", file: "note.md", summary: "Did important work", source: "content", hidden: false, blockStart: 0, blockEnd: 0 }
						],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null
					}
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-10"], "force", ["year"] as any);
		expect(jobs.length).toBeGreaterThan(0);
		expect((jobs[0] as any).epochBucket).toBe("year");
		expect((jobs[0] as any).epochStart).toBe("2026-01-01");
		const input = String((jobs[0] as any).input || "");
		expect(input).toContain("note.md:");
		expect(input).toContain("Did important work");
		expect(input).not.toContain("epoch://month/");
	});
});
