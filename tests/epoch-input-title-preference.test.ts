import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch generation uses full path labels", () => {
	it("does not append extracted titles", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "notes/2025-01-01.md",
					source: "cdate",
						summary: "Did something",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = {
			indexer: { index },
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" })
				},
				metadataCache: {
					getFileCache: () => ({ frontmatter: { title: "Project Alpha" } })
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("notes/2025-01-01.md:");
			expect(input).not.toContain("Project Alpha");
	});

	it("always uses the full path label", async () => {
		const dateKey = "2025-01-01";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "notes/Daily Note.md",
					source: "cdate",
						summary: "Did something else",
					blockStart: 0,
					blockEnd: 0
				}
			]
		};

		const plugin: any = {
			indexer: { index },
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" })
				},
				metadataCache: {
					getFileCache: () => ({ frontmatter: { title: "2025-01-01" } })
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");
		expect(input).toContain("notes/Daily Note.md:");
	});
});
