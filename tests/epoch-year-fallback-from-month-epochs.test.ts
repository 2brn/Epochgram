import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Year epoch fallback", () => {
	it("generates year input from existing child epoch entries when no per-note records exist", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2026-02-01": [
						{
							date: "2026-02-01",
							file: "epoch://month/2026-02-01-2026-02-29",
							summary: "February theme summary",
							source: "epoch",
							epochBucket: "month",
							epochStart: "2026-02-01",
							epochEnd: "2026-02-29",
							hidden: false
						}
					]
				},
				files: {}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-10"], "force", ["year"] as any);
		expect(jobs.length).toBeGreaterThan(0);
		expect((jobs[0] as any).epochBucket).toBe("year");
		const input = String((jobs[0] as any).input || "");
		expect(input).toContain("February theme summary");
		expect(input).toContain("epoch://month/2026-02-01-2026-02-29:");
	});
});
