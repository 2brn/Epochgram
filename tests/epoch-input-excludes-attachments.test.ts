import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Epoch input non-text attachments", () => {
	it("appends non-text attachments as an Attachments list", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2026-02-10": [
						{ date: "2026-02-10", file: "image.png", summary: "", source: "cdate", hidden: false },
						{ date: "2026-02-10", file: "note.md", summary: "Did important work", source: "content", hidden: false }
					]
				}
			},
			app: { vault: { adapter: { read: async () => "" } } },
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-10"], "force", ["day"]);
		expect(jobs.length).toBeGreaterThan(0);
		const input = String((jobs[0] as any).input || "");
		expect(input).toContain("note.md:");
		expect(input).toContain("Did important work");
		expect(input).toContain("Attachments:");
		expect(input).toContain("- image.png");
	});
});
