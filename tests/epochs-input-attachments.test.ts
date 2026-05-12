import { describe, expect, it } from "vitest";

import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch generation includes non-text attachments", () => {
	it("appends an Attachments list to the end of the epoch input", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2026-01-10": [
						{
							date: "2026-01-10",
							file: "Assets/img.png",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: ""
						}
					]
				},
				files: {}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-01-10"], "missing", ["day"] as any);
		expect(jobs.length).toBe(1);
		expect(jobs[0]!.filePath).toBe("epoch://day/2026-01-10-2026-01-10");
		expect(jobs[0]!.input).toContain("Attachments:");
		expect(jobs[0]!.input).toContain("- Assets/img.png");
	});
});
