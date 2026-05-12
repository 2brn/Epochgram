import { describe, expect, it } from "vitest";
import { buildEpochJobs } from "../src/plugin/ai-summaries/epochs";

describe("Epoch year fallback from child epoch summaries", () => {
	it("generates a missing year bucket from month epoch entries when there are no per-record items", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2026-02-01": [
						{
							date: "2026-02-01",
							file: "epoch://month/2026-02-01-2026-02-28",
							summary: "",
							aiSummary: "Built solid habits",
							source: "epoch",
							epochBucket: "month",
							epochStart: "2026-02-01",
							epochEnd: "2026-02-28"
						}
					]
				},
				files: {}
			},
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};

		const jobs = await buildEpochJobs(plugin, "force");
		const yearJobs = jobs.filter((j: any) => j && j.epochBucket === "year");
		expect(yearJobs.length).toBeGreaterThan(0);
		expect(yearJobs[0].epochStart).toBe("2026-01-01");
		const input = String(yearJobs[0].input || "");
		expect(input).toContain("epoch://month/2026-02-01-2026-02-28:");
		expect(input).toContain("Built solid habits");
	});
});
