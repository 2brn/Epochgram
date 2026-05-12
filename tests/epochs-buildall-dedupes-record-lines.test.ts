import { describe, expect, it } from "vitest";
import { buildEpochJobs } from "../src/plugin/ai-summaries/epochs";

describe("epochs build-all de-dupes duplicate record lines", () => {
	it("does not emit duplicate lines in year epoch input", async () => {
		const line = "Atacama Skeleton: Discovery of a Possible Early Homo Species";
		const plugin: any = {
			indexer: {
				index: {},
				files: {
					"x.md": {
						contentDates: [
							{ date: "2013-06-01", file: "x.md", source: "content", summary: line, blockStart: 0, blockEnd: 0 },
							{ date: "2013-06-01", file: "x.md", source: "content", summary: line, blockStart: 0, blockEnd: 0 }
						]
					}
				}
			},
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};

		const jobs = await buildEpochJobs(plugin, "force");
		const yearJob = jobs.find((j: any) => j && j.kind === "epoch" && j.epochBucket === "year" && j.epochStart === "2013-01-01");
		expect(yearJob).toBeTruthy();

		const input = String((yearJob as any).input || "");
		const matches = input.split(/\r\n|\n|\r|\u2028|\u2029/g).filter((l) => l.trim() === `- ${line}`);
		expect(matches).toHaveLength(1);
	});
});
