import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

// Regression: epoch AI inputs should label items by file path (not only note title).
// This is especially important for tracked-change entries where the label may otherwise
// appear as just a short title like "4th stage".

describe("epoch generation input labels include full path (tracked)", () => {
	it("includes the full file path for tracked entries", async () => {
		const dateKey = "2026-02-13";
		const index: any = {
			[dateKey]: [
				{
					date: dateKey,
					file: "Projects/Stages/4th stage.md",
					source: "tracked",
					summary: "MacOS extra tab improvement aims to reduce AI context",
					blockStart: 0,
					blockEnd: 0,
					trackedChange: "added"
				},
				{
					date: dateKey,
					file: "Projects/Stages/4th stage.md",
					source: "tracked",
					summary: "MacOS extra tab improvement aims to reduce AI context",
					blockStart: 1,
					blockEnd: 1,
					trackedChange: "modified"
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
					getFileCache: () => ({ frontmatter: { title: "4th stage" } })
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);
		const input = String(jobs[0]?.input ?? "");

		expect(input).toContain("Projects/Stages/4th stage.md:");
		expect(input).toContain("- Added");
		expect(input).toContain("- Edited");
	});
});
