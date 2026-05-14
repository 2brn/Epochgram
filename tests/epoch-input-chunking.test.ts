import { describe, it, expect } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

// Regression: large epoch inputs should be chunked (and later reduced)
// rather than being clipped/truncated into a single job.

describe("epoch generation input chunking", () => {
	it("splits large epoch input into chunked jobs", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: Array.from({ length: 260 }, (_, i) => ({
				date: dateKey,
				file: `note-${i}.md`,
				source: "content",
				summary: `ITEM ${i}: ` + "x".repeat(40),
				blockStart: 0,
				blockEnd: 0
			}))
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBeGreaterThan(1);
		const groupId = String(jobs[0]?.groupId ?? "");
		expect(groupId).not.toBe("");
		for (const j of jobs) {
			expect(String(j.groupId ?? "")).toBe(groupId);
			expect(typeof j.chunkIndex).toBe("number");
			expect(typeof j.chunkCount).toBe("number");
			expect(j.chunkCount).toBe(jobs.length);
			expect(j.reduce).toBe(true);
			expect(j.reduceDepth).toBe(0);
		}
	});
});
