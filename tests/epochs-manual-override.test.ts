import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys, storeEpochSummary } from "../src/plugin/ai-summaries/epochs";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("epoch summaries", () => {
	it("does not use child epochs as parent inputs", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "b.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "World"
						},
						{
							date: "2025-01-02",
							file: "epoch://day/2025-01-02-2025-01-02",
							blockStart: 0,
							blockEnd: 0,
							source: "epoch",
							epochBucket: "day",
							epochStart: "2025-01-02",
							epochEnd: "2025-01-02",
							summary: "Auto",
							aiSummary: "Auto",
							aiSummaryInputHash: "h"
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2025-01-02"], "force", ["2days"] as any);
		expect(jobs.length).toBe(1);
		expect(jobs[0]!.input).toContain("World");
		expect(jobs[0]!.input).not.toContain("Auto");
	});

	it("stores the latest AI summary for an epoch", () => {
		const epochEntry: any = {
			date: "2025-01-01",
			file: "epoch://day/2025-01-01-2025-01-01",
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			epochBucket: "day",
			epochStart: "2025-01-01",
			epochEnd: "2025-01-01",
			summary: "Auto",
			aiSummary: "Auto",
			aiSummaryInputHash: "h"
		};
		const plugin: any = withTrustedPro({
			hasProAccess: () => true,
			settings: { generateEpochs: true },
			indexer: { index: { "2025-01-01": [epochEntry] } }
		});

		storeEpochSummary(
			plugin,
			{
				id: "1",
				filePath: "epoch://day/2025-01-01-2025-01-01",
				kind: "epoch",
				date: "2025-01-01",
				blockStart: 0,
				blockEnd: 0,
				source: "epoch",
				input: "- a",
				context: "",
				inputHash: "newhash",
				createdAt: Date.now(),
				epochBucket: "day",
				epochStart: "2025-01-01",
				epochEnd: "2025-01-01"
			} as any,
			"NEW AUTO"
		);

		const updated = plugin.indexer.index["2025-01-01"][0];
		expect(updated.summary).toBe("NEW AUTO");
		expect(updated.aiSummary).toBe("NEW AUTO");
		expect(updated.aiSummaryInputHash).toBe("newhash");
	});
});
