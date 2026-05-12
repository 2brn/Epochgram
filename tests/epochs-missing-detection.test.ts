import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epochs missing detection", () => {
	it("treats aiSummary-only epoch entry as present", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "a.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "Hello"
						},
						{
							date: "2025-01-01",
							file: "epoch://day/2025-01-01-2025-01-01",
							blockStart: 0,
							blockEnd: 0,
							source: "epoch",
							epochBucket: "day",
							epochStart: "2025-01-01",
							epochEnd: "2025-01-01",
							summary: "",
							aiSummary: "Already summarized",
							aiSummaryInputHash: "somehash"
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-01"], "missing", ["day"] as any);
		expect(jobs.length).toBe(0);
	});

	it("finds epoch entry even if stored under different index date key", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "a.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "Hello"
						}
					],
					// Wrong key: epochStart is 2025-01-01 but entry lives under 2025-01-02
					"2025-01-02": [
						{
							date: "2025-01-01",
							file: "epoch://day/2025-01-01-2025-01-01",
							blockStart: 0,
							blockEnd: 0,
							source: "epoch",
							epochBucket: "day",
							epochStart: "2025-01-01",
							epochEnd: "2025-01-01",
							summary: "Already summarized",
							aiSummaryInputHash: "somehash"
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-01"], "missing", ["day"] as any);
		expect(jobs.length).toBe(1);
	});

	it("still generates when epoch entry has no text", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "a.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "Hello"
						},
						{
							date: "2025-01-01",
							file: "epoch://day/2025-01-01-2025-01-01",
							blockStart: 0,
							blockEnd: 0,
							source: "epoch",
							epochBucket: "day",
							epochStart: "2025-01-01",
							epochEnd: "2025-01-01",
							summary: "",
							aiSummary: "",
							aiSummaryInputHash: ""
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-01"], "missing", ["day"] as any);
		expect(jobs.length).toBe(1);
		expect(jobs[0]!.filePath).toBe("epoch://day/2025-01-01-2025-01-01");
	});
});
