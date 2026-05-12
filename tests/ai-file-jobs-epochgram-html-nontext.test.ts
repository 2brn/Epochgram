import { describe, expect, it } from "vitest";
import { buildJobsForFile } from "../src/plugin/ai-summaries/file-jobs";

describe("ai file jobs", () => {
	it("does not build jobs for epochgram-*.html exports", async () => {
		const res = await buildJobsForFile({} as any, "Daily/epochgram-2026-02-16.html", false);
		expect(res.jobs).toEqual([]);
		expect(res.reason).toBe("Only text files are supported");
	});
});
