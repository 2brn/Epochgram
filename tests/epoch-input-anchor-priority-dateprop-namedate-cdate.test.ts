import { describe, expect, it } from "vitest";

import { buildEpochJobs, buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";
import { parseDateKey, pickEpochPeriod } from "../src/plugin/ai-summaries/shared";

describe("epoch AI input anchor priority", () => {
	it("prefers dateprop over namedate within a multi-day period", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							source: "namedate",
							summary: "Namedate summary",
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

		const jobsDateKey = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["week"] as any);
		const jobDateKey = jobsDateKey.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!jobDateKey) throw new Error(`Expected week job: ${expectedFilePath}`);
		const inputDateKey = String(jobDateKey.input ?? "");
		expect(inputDateKey).toContain("Dateprop summary");
		expect(inputDateKey).not.toContain("Namedate summary");

		const jobsBuildAll = await buildEpochJobs(plugin, "force");
		const jobBuildAll = jobsBuildAll.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!jobBuildAll) throw new Error(`Expected week job: ${expectedFilePath}`);
		const inputBuildAll = String(jobBuildAll.input ?? "");
		expect(inputBuildAll).toContain("Dateprop summary");
		expect(inputBuildAll).not.toContain("Namedate summary");
	});

	it("prefers namedate over cdate within a multi-day period when dateprop is absent", async () => {
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
							source: "namedate",
							summary: "Namedate summary",
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

		const jobsDateKey = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["week"] as any);
		const jobDateKey = jobsDateKey.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!jobDateKey) throw new Error(`Expected week job: ${expectedFilePath}`);
		const inputDateKey = String(jobDateKey.input ?? "");
		expect(inputDateKey).toContain("Namedate summary");
		expect(inputDateKey).not.toContain("Cdate summary");

		const jobsBuildAll = await buildEpochJobs(plugin, "force");
		const jobBuildAll = jobsBuildAll.find((j: any) => String(j?.filePath) === expectedFilePath);
		if (!jobBuildAll) throw new Error(`Expected week job: ${expectedFilePath}`);
		const inputBuildAll = String(jobBuildAll.input ?? "");
		expect(inputBuildAll).toContain("Namedate summary");
		expect(inputBuildAll).not.toContain("Cdate summary");
	});
});
