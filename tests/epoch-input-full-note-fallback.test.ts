import { describe, expect, it } from "vitest";

import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("epoch input full-note fallback", () => {
	it("does not read full note content (summaries-only inputs)", async () => {
		const dateKey = "2026-03-05";
		const filePath = "Notes/note.md";
		const adapter = {
			async read(_path: string): Promise<string> {
				throw new Error("read() should not be called");
			}
		};

		const plugin: any = {
			settings: { generateEpochs: true },
			app: { vault: { adapter } },
			indexer: {
				files: {},
				index: {
					[dateKey]: [
						{
							date: dateKey,
							file: filePath,
							source: "content",
							summary: "SHORT SUMMARY SHOULD NOT WIN",
							blockStart: 0,
							blockEnd: 0
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);

		const input = String((jobs[0] as any)?.input ?? "");
		expect(input).toContain(`${filePath}:`);
		expect(input).toContain("SHORT SUMMARY SHOULD NOT WIN");
		expect(input).not.toContain("| Alpha");
	});
});
