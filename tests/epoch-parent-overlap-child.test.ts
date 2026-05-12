import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Epoch parent buckets include overlapping child epochs", () => {
	it("builds a month epoch even when the only 2weeks child starts before the month", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2005-11-28": [
						{
							date: "2005-11-28",
							file: "epoch://2weeks/2005-11-28-2005-12-11",
							blockStart: 0,
							blockEnd: 0,
							summary: "",
							source: "epoch",
							epochBucket: "2weeks",
							epochStart: "2005-11-28",
							epochEnd: "2005-12-11",
							aiSummary: "2weeks summary that overlaps December",
							aiSummaryInputHash: "hash"
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2005-12-01"], "force", ["month"] as any);
		expect(jobs.length).toBe(0);
	});
});
