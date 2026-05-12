import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epochs date keys fallback", () => {
	it("builds day epoch jobs from indexer.files when index is sparse", async () => {
		const plugin: any = {
			indexer: {
				index: {},
				files: {
					"a.md": {
						contentDates: [
							{
								date: "2025-01-01",
								file: "a.md",
								source: "content",
								summary: "Alpha summary",
								blockStart: 0,
								blockEnd: 0
							},
							{
								date: "2025-01-02",
								file: "a.md",
								source: "content",
								summary: "Beta summary",
								blockStart: 0,
								blockEnd: 0
							}
						]
					}
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-01", "2025-01-02"], "force", ["day"] as any);
		expect(jobs.length).toBe(2);
		expect(jobs.map(j => j.filePath).sort()).toEqual([
			"epoch://day/2025-01-01-2025-01-01",
			"epoch://day/2025-01-02-2025-01-02"
		]);
		const inputs = jobs.map(j => String(j.input ?? ""));
		expect(inputs.some(t => t.includes("Alpha summary"))).toBe(true);
		expect(inputs.some(t => t.includes("Beta summary"))).toBe(true);
	});
});
