import { describe, expect, it } from "vitest";

import { buildEpochJobs, buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";
import { parseDateKey, pickEpochPeriod } from "../src/plugin/ai-summaries/shared";

describe("epoch AI input anchor selection", () => {
	it("prefers dateprop over cdate within a multi-day period (date-key path)", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							source: "cdate",
							summary: "Cdate summary",
							blockStart: 0,
							blockEnd: 0
						}
					],
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "A.md",
							source: "dateprop",
							summary: "Dateprop summary",
							blockStart: 0,
							blockEnd: 0
						}
					]
				},
				files: {}
			}
		};

		const d = parseDateKey("2025-01-02");
		if (!d) throw new Error("Bad test date");
		const p = pickEpochPeriod("week" as any, d);
		const expectedFilePath = `epoch://week/${p.start}-${p.end}`;

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["week"] as any);
		const job = jobs.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!job) throw new Error(`Expected week job: ${expectedFilePath}`);
		const input = String(job.input ?? "");
		expect(input).toContain("Dateprop summary");
		expect(input).not.toContain("Cdate summary");
	});

	it("prefers dateprop over cdate within a multi-day period (build-all path)", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							source: "cdate",
							summary: "Cdate summary",
							blockStart: 0,
							blockEnd: 0
						}
					],
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "A.md",
							source: "dateprop",
							summary: "Dateprop summary",
							blockStart: 0,
							blockEnd: 0
						}
					]
				},
				files: {}
			}
		};

		const d = parseDateKey("2025-01-02");
		if (!d) throw new Error("Bad test date");
		const p = pickEpochPeriod("week" as any, d);
		const expectedFilePath = `epoch://week/${p.start}-${p.end}`;

		const jobs = await buildEpochJobs(plugin, "force");
		const job = jobs.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!job) throw new Error(`Expected week job: ${expectedFilePath}`);
		const input = String(job.input ?? "");
		expect(input).toContain("Dateprop summary");
		expect(input).not.toContain("Cdate summary");
	});
});
