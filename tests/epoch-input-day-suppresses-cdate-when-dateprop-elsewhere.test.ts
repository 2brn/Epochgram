import { describe, expect, it } from "vitest";

import { buildEpochJobs, buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch AI input", () => {
	it("suppresses cdate on today when dateprop exists on another day (date-key day)", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "A.md",
							source: "dateprop",
							summary: "Dateprop summary",
							blockStart: 0,
							blockEnd: 0
						}
					],
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							source: "cdate",
							summary: "Cdate today summary",
							blockStart: 0,
							blockEnd: 0
						},
						{
							date: "2025-01-02",
							file: "A.md",
							source: "namedate",
							summary: "Namedate today summary",
							blockStart: 0,
							blockEnd: 0
						},
						{
							date: "2025-01-02",
							file: "B.md",
							source: "content",
							summary: "Other summary",
							blockStart: 0,
							blockEnd: 0
						}
					]
				},
				files: {}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]!.input ?? "");
		expect(input).toContain("Other summary");
		expect(input).not.toContain("Cdate today summary");
		expect(input).not.toContain("Namedate today summary");
		// The day input should also not pull in the other-day dateprop anchor.
		expect(input).not.toContain("Dateprop summary");
	});

	it("suppresses cdate on today when dateprop exists on another day (build-all day)", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "A.md",
							source: "dateprop",
							summary: "Dateprop summary",
							blockStart: 0,
							blockEnd: 0
						}
					],
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							source: "cdate",
							summary: "Cdate today summary",
							blockStart: 0,
							blockEnd: 0
						},
						{
							date: "2025-01-02",
							file: "A.md",
							source: "namedate",
							summary: "Namedate today summary",
							blockStart: 0,
							blockEnd: 0
						},
						{
							date: "2025-01-02",
							file: "B.md",
							source: "content",
							summary: "Other summary",
							blockStart: 0,
							blockEnd: 0
						}
					]
				},
				files: {}
			}
		};

		const jobs = await buildEpochJobs(plugin, "force");
		const dayJob = jobs.find((j: any) => String(j?.filePath) === "epoch://day/2025-01-02-2025-01-02");
		if (!dayJob) throw new Error("Expected day job for 2025-01-02");
		const input = String(dayJob.input ?? "");
		expect(input).toContain("Other summary");
		expect(input).not.toContain("Cdate today summary");
		expect(input).not.toContain("Namedate today summary");
		expect(input).not.toContain("Dateprop summary");
	});
});
