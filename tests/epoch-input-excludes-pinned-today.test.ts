import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch AI input", () => {
	it("excludes synthetic pinned-today entries", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "Normal summary"
						},
						{
							date: "2025-01-02",
							originalDate: "2025-01-01",
							pinned: true,
							file: "Pinned.md",
							blockStart: 0,
							blockEnd: 0,
							source: "cdate",
							summary: "Pinned summary"
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		expect(jobs[0]!.input).toContain("Normal summary");
		expect(jobs[0]!.input).not.toContain("Pinned summary");
	});
});
