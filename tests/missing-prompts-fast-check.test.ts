import { describe, expect, it } from "vitest";
import { hasMissingAiSummariesFast } from "../src/plugin/ai-summaries/file-jobs";
import { countMissingEpochsFast, hasMissingEpochsFast } from "../src/plugin/ai-summaries/epochs";
import { EPOCH_BUCKET_ORDER, parseDateKey, pickEpochPeriod } from "../src/plugin/ai-summaries/shared";

describe("missing prompts fast checks", () => {
	it("hasMissingAiSummariesFast: false when no indexer/files", () => {
		const plugin: any = { indexer: null };
		expect(hasMissingAiSummariesFast(plugin)).toBe(false);
	});

	it("hasMissingAiSummariesFast: true for tracked entry with missing ai", () => {
		const plugin: any = {
			indexer: {
				files: {
					"a.md": {
						trackedDates: {
							"2025-01-01": [
								{
									date: "2025-01-01",
									blockStart: 0,
									blockEnd: 0,
									source: "tracked",
									summary: "Something changed",
									aiSummary: "",
									aiSummaryInputHash: ""
								}
							]
						}
					}
				}
			}
		};
		expect(hasMissingAiSummariesFast(plugin)).toBe(true);
	});

	it("hasMissingAiSummariesFast: false when ai summary + hash present", () => {
		const plugin: any = {
			indexer: {
				files: {
					"a.md": {
						cdate: {
							date: "2025-01-01",
							blockStart: 0,
							blockEnd: 0,
							source: "cdate",
							summary: "Non-empty",
							aiSummary: "AI",
							aiSummaryInputHash: "hash"
						}
					}
				}
			}
		};
		expect(hasMissingAiSummariesFast(plugin)).toBe(false);
	});

	it("hasMissingEpochsFast: false when no non-epoch entries", () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-01": [
						{
							date: "2025-01-01",
							file: "epoch://day/2025-01-01-2025-01-01",
							blockStart: 0,
							blockEnd: 0,
							source: "epoch",
							summary: "ok",
							epochBucket: "day",
							epochStart: "2025-01-01",
							epochEnd: "2025-01-01"
						}
					]
				}
			}
		};
		expect(hasMissingEpochsFast(plugin)).toBe(false);
	});

	it("hasMissingEpochsFast: true when there are non-epoch entries but no epochs", () => {
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
							summary: "hello"
						}
					]
				}
			}
		};
		expect(hasMissingEpochsFast(plugin)).toBe(true);
	});

	it("countMissingEpochsFast: 0 when all required periods have summaries", () => {
		const dayKey = "2025-01-06";
		const d = parseDateKey(dayKey);
		if (!d) throw new Error("bad test date");

		const index: any = {
			[dayKey]: [
				{
					date: dayKey,
					file: "a.md",
					blockStart: 0,
					blockEnd: 0,
					source: "content",
					summary: "hello"
				}
			]
		};

		for (const bucket of EPOCH_BUCKET_ORDER) {
			const p = pickEpochPeriod(bucket as any, d);
			const start = p.start;
			index[start] = [
				{
					date: start,
					file: `epoch://${bucket}/${start}-${p.end}`,
					blockStart: 0,
					blockEnd: 0,
					source: "epoch",
					summary: "Auto",
					aiSummary: "Auto",
					epochBucket: bucket,
					epochStart: start,
					epochEnd: p.end
				}
			];
		}

		const plugin: any = { indexer: { index } };
		expect(countMissingEpochsFast(plugin)).toBe(0);
		expect(hasMissingEpochsFast(plugin)).toBe(false);
	});
});
