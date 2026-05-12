import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("Epoch input anchors (summaries-only)", () => {
	it("when an anchor record is present for a file, other record types for that file are excluded", async () => {
		const dateKey = "2026-03-01";
		const filePath = "Notes/note.md";
		const adapter = {
			async read(_path: string): Promise<string> {
				throw new Error("read() should not be called");
			}
		};

		const plugin: any = {
			app: { vault: { adapter } },
			indexer: {
				files: {},
				index: {
					[dateKey]: [
						// Anchor record (dateprop) should win and suppress the tracked entry.
						{
							date: dateKey,
							file: filePath,
							source: "dateprop",
							summary: "ANCHOR SUMMARY SHOULD APPEAR",
							blockStart: 2,
							blockEnd: 3,
							hidden: false
						},
						{
							date: dateKey,
							file: filePath,
							source: "tracked",
							trackedChange: "modified",
							summary: "TRACKED SUMMARY SHOULD BE SUPPRESSED",
							blockStart: 1,
							blockEnd: 1,
							hidden: false
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);

		const input = String((jobs[0] as any).input || "");
		expect(input).toContain(`${filePath}:`);

		// Summaries-only: do not read exact blocks / full note content.
		expect(input).not.toContain("| L2");
		expect(input).not.toContain("| L3");
		expect(input).toContain("ANCHOR SUMMARY SHOULD APPEAR");

		// Non-anchor entry should be suppressed for that file.
		expect(input).not.toContain("Edited");
		expect(input).not.toContain("TRACKED SUMMARY SHOULD BE SUPPRESSED");
	});

	it("uses the tracked summary text (does not read exact blocks)", async () => {
		const dateKey = "2026-03-02";
		const filePath = "Notes/changes.md";
		const adapter = {
			async read(_path: string): Promise<string> {
				throw new Error("read() should not be called");
			}
		};

		const plugin: any = {
			app: { vault: { adapter } },
			indexer: {
				files: {},
				index: {
					[dateKey]: [
						{
							date: dateKey,
							file: filePath,
							source: "tracked",
							trackedChange: "modified",
							summary: "TRACKED SUMMARY SHOULD APPEAR",
							blockStart: 2,
							blockEnd: 3,
							hidden: false
						}
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, [dateKey], "force", ["day"] as any);
		expect(jobs.length).toBe(1);

		const input = String((jobs[0] as any).input || "");
		expect(input).toContain(`${filePath}:`);
		expect(input).toContain("- Edited");
		expect(input).toContain("TRACKED SUMMARY SHOULD APPEAR");
		expect(input).not.toContain("| BBB");
		expect(input).not.toContain("| CCC");
	});
});
