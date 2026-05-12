import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch AI input", () => {
	it("excludes recurring synthetic entries", async () => {
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
							file: "A.md",
							blockStart: 1,
							blockEnd: 1,
							source: "content",
							summary: "Recurring summary",
							recurring: true
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		expect(jobs[0]!.input).toContain("Normal summary");
		expect(jobs[0]!.input).not.toContain("Recurring summary");
	});
});
