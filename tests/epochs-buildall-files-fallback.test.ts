import { describe, expect, it } from "vitest";
import { buildEpochJobs } from "../src/plugin/ai-summaries/epochs";

describe("epochs build-all fallback", () => {
	it("builds day epoch jobs from indexer.files when index has no day entries", async () => {
		const plugin: any = {
			indexer: {
				index: {
					// Intentionally sparse: no non-epoch day entries.
				},
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

		const jobs = await buildEpochJobs(plugin, "force");
		const dayJobs = jobs.filter((j: any) => String(j?.epochBucket) === "day");
		expect(dayJobs.map((j: any) => j.filePath).sort()).toEqual([
			"epoch://day/2025-01-01-2025-01-01",
			"epoch://day/2025-01-02-2025-01-02"
		]);
		const inputs = dayJobs.map((j: any) => String(j.input ?? ""));
		expect(inputs.some((t: string) => t.includes("Alpha summary"))).toBe(true);
		expect(inputs.some((t: string) => t.includes("Beta summary"))).toBe(true);
	});
});
