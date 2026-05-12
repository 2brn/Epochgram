import { describe, it, expect, vi } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";
import { markEpochInputAiSummaryError } from "../src/plugin/ai-summaries/epoch-input-ai-fallback";

// Ensures epoch input text uses the correct summary priority:
// aiSummary > summary.

describe("epoch generation input priority", () => {
	it("uses ai summary over normal summary", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "note.md",
					source: "content",
					summary: "CONTENT SUMMARY SHOULD NOT WIN",
					aiSummary: "AI SUMMARY SHOULD WIN",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("AI SUMMARY SHOULD WIN");
		expect(input).not.toContain("CONTENT SUMMARY SHOULD NOT WIN");
	});

	it("uses normal summary when there is no ai summary", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "note.md",
					source: "content",
					summary: "CONTENT SUMMARY SHOULD WIN",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("CONTENT SUMMARY SHOULD WIN");
	});

	it("falls back to normal summary when ai summary errored", async () => {
		const dateKey = "2025-01-01";
		const entry: any = {
			date: dateKey,
			file: "note.md",
			source: "content",
			summary: "CONTENT SUMMARY SHOULD WIN",
			aiSummary: "AI SUMMARY SHOULD NOT WIN",
			blockStart: 0,
			blockEnd: 0
		};
		const index: any = { [dateKey]: [entry] };
		const plugin: any = { indexer: { index } };
		markEpochInputAiSummaryError(plugin, [entry], "hash1", "bridge error");

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("CONTENT SUMMARY SHOULD WIN");
		expect(input).not.toContain("AI SUMMARY SHOULD NOT WIN");
	});

	it("uses base summary over ai summary when YAML description exists", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "note.md",
					source: "content",
					summary: "YAML SUMMARY SHOULD WIN",
					aiSummary: "AI SUMMARY SHOULD NOT WIN",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = {
			indexer: { index },
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(() => ({ path: "note.md" }))
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: { description: "Manual YAML" } }))
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("Manual YAML");
		expect(input).not.toContain("AI SUMMARY SHOULD NOT WIN");
	});

	it("does not queue day epoch jobs for date-only anchor notes", async () => {
		const dateKey = "2026-04-19";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "2026-04-19.md",
					source: "cdate",
					summary: dateKey,
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(0);
	});

	it("does not queue day epoch jobs for date-only anchor notes with numeric suffix", async () => {
		const dateKey = "2026-04-19";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "2026-04-19 (1).md",
					source: "cdate",
					summary: `${dateKey} (1)`,
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(0);
	});

	it("does not queue month epoch jobs when adding an empty date-named note", async () => {
		const touchedDay = "2026-04-19";
		const otherDay = "2026-04-18";
		const index: any = {
			[otherDay]: [
				{
					date: otherDay,
					file: "note.md",
					source: "content",
					summary: "Did something meaningful",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = { indexer: { index } };
		const initial = await buildEpochJobsForDateKeys(plugin, [touchedDay], "force", ["month"] as any);
		expect(initial.length).toBe(1);
		const monthJob: any = initial[0];
		const start = String(monthJob?.epochStart ?? "");
		const end = String(monthJob?.epochEnd ?? "");
		const epochFilePath = String(monthJob?.filePath ?? "");
		const inputHash = String(monthJob?.inputHash ?? "");
		expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(epochFilePath.startsWith("epoch://")).toBe(true);
		expect(inputHash.length).toBeGreaterThan(0);

		(index[start] ??= []).push({
			file: epochFilePath,
			source: "epoch",
			date: start,
			epochBucket: "month",
			epochStart: start,
			epochEnd: end,
			aiSummary: "Existing month epoch",
			aiSummaryInputHash: inputHash,
			blockStart: 0,
			blockEnd: 0
		});

		const freshBefore = await buildEpochJobsForDateKeys(plugin, [touchedDay], "staleOrMissing", ["month"] as any);
		expect(freshBefore.length).toBe(0);

		(index[touchedDay] ??= []).push({
			date: touchedDay,
			file: `${touchedDay}.md`,
			source: "content",
			summary: touchedDay,
			blockStart: 0,
			blockEnd: 0
		});

		const freshAfter = await buildEpochJobsForDateKeys(plugin, [touchedDay], "staleOrMissing", ["month"] as any);
		expect(freshAfter.length).toBe(0);
	});

	it("does not stale 2days epochs when a frontmatter-only daily note creates a cdate row on the creation day", async () => {
		const createdDay = "2026-04-18";
		const dailyNoteDay = "2026-04-19";
		const index: any = {
			[createdDay]: [
				{
					date: createdDay,
					file: "note.md",
					source: "content",
					summary: "Did something meaningful",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};
		const plugin: any = { indexer: { index } };

		const initial = await buildEpochJobsForDateKeys(plugin, [createdDay], "force", ["2days"] as any);
		expect(initial.length).toBe(1);
		const twoDaysJob: any = initial[0];
		const start = String(twoDaysJob?.epochStart ?? "");
		const end = String(twoDaysJob?.epochEnd ?? "");
		const epochFilePath = String(twoDaysJob?.filePath ?? "");
		const inputHash = String(twoDaysJob?.inputHash ?? "");
		expect(epochFilePath.startsWith("epoch://")).toBe(true);
		expect(inputHash.length).toBeGreaterThan(0);

		(index[start] ??= []).push({
			file: epochFilePath,
			source: "epoch",
			date: start,
			epochBucket: "2days",
			epochStart: start,
			epochEnd: end,
			aiSummary: "Existing 2days epoch",
			aiSummaryInputHash: inputHash,
			blockStart: 0,
			blockEnd: 0
		});

		const freshBefore = await buildEpochJobsForDateKeys(plugin, [createdDay], "staleOrMissing", ["2days"] as any);
		expect(freshBefore.length).toBe(0);

		// Simulate a frontmatter-only daily note created on 04-18 but named/dated 04-19,
		// where the cdate row can land on the creation day with a date-only summary.
		(index[createdDay] ??= []).push({
			date: createdDay,
			file: `${dailyNoteDay}.md`,
			source: "cdate",
			summary: dailyNoteDay,
			blockStart: 0,
			blockEnd: 0
		});

		const freshAfter = await buildEpochJobsForDateKeys(plugin, [createdDay], "staleOrMissing", ["2days"] as any);
		expect(freshAfter.length).toBe(0);
	});

	it("does not queue day epoch jobs for an empty date-named daily note", async () => {
		const dateKey = "2026-04-19";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: `${dateKey}.md`,
					source: "content",
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

	it("does not stale 2days epochs when an empty date-named daily note is added", async () => {
		const createdDay = "2026-04-18";
		const index: any = {
			[createdDay]: [
				{
					date: createdDay,
					file: "note.md",
					source: "content",
					summary: "Did something meaningful",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};
		const plugin: any = { indexer: { index } };

		const initial = await buildEpochJobsForDateKeys(plugin, [createdDay], "force", ["2days"] as any);
		expect(initial.length).toBe(1);
		const job: any = initial[0];
		const start = String(job?.epochStart ?? "");
		const end = String(job?.epochEnd ?? "");
		const epochFilePath = String(job?.filePath ?? "");
		const inputHash = String(job?.inputHash ?? "");

		(index[start] ??= []).push({
			file: epochFilePath,
			source: "epoch",
			date: start,
			epochBucket: "2days",
			epochStart: start,
			epochEnd: end,
			aiSummary: "Existing 2days epoch",
			aiSummaryInputHash: inputHash,
			blockStart: 0,
			blockEnd: 0
		});

		const freshBefore = await buildEpochJobsForDateKeys(plugin, [createdDay], "staleOrMissing", ["2days"] as any);
		expect(freshBefore.length).toBe(0);

		// Empty daily note (no YAML date, blank content) that still gets indexed.
		(index[createdDay] ??= []).push({
			date: createdDay,
			file: "2026-04-19.md",
			source: "content",
			summary: "",
			blockStart: 0,
			blockEnd: 0
		});

		const freshAfter = await buildEpochJobsForDateKeys(plugin, [createdDay], "staleOrMissing", ["2days"] as any);
		expect(freshAfter.length).toBe(0);
	});
});
