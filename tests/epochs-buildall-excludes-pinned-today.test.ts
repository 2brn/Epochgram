import { describe, expect, it } from "vitest";
import { buildEpochJobs } from "../src/plugin/ai-summaries/epochs";

describe("epochs build-all", () => {
	it("excludes synthetic pinned-today entries from epoch inputs", async () => {
		const plugin: any = {
			indexer: {
				index: {
					"2025-01-02": [
						{
							date: "2025-01-02",
							file: "A.md",
							blockStart: 0,
							blockEnd: 0,
							source: "content",
							summary: "Normal summary"
						},
						{
							date: "2025-01-02",
							originalDate: "2025-01-01",
							pinned: true,
							file: "Pinned.md",
							blockStart: 0,
							blockEnd: 0,
							source: "cdate",
							summary: "Pinned summary"
						}
					]
				},
				files: {}
			}
		};

		const jobs = await buildEpochJobs(plugin, "force");
		const dayJobs = jobs.filter((j: any) => String(j?.epochBucket) === "day");
		expect(dayJobs.length).toBeGreaterThan(0);
		const inputs = dayJobs.map((j: any) => String(j?.input ?? "")).join("\n\n");
		expect(inputs).toContain("Normal summary");
		expect(inputs).not.toContain("Pinned summary");
	});
});
