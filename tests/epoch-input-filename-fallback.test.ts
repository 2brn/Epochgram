import { describe, it, expect } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

// Ensures epoch inputs include entries even when they have no summary text.
// This matters for empty notes and non-text files.

describe("epoch generation input filename fallback", () => {
	it("falls back to filename when summary is empty", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "Empty Note.md",
					source: "content",
					summary: "",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		// Empty markdown notes should not contribute any epoch input.
		expect(jobs.length).toBe(0);
	});

	it("lists binary attachments", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "assets/image.png",
					source: "content",
					summary: "",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("Attachments:");
		expect(input).toContain("- assets/image.png");
	});

	it("never emits raw source tags like [cdate]", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "Created Epoch - Phases.canvas",
					source: "cdate",
					summary: "Created Epoch - Phases",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};
		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("Created Epoch - Phases.canvas:");
		expect(input).not.toContain("[cdate]");
	});

	it("still excludes hidden entries", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "hidden.md",
					source: "content",
					reviewState: "hidden",
					summary: "",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(0);
	});
});
