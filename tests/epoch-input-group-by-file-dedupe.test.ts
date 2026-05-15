import { describe, expect, it } from "vitest";
import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";
import { validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("Epoch input grouping + dedupe", () => {
		it("groups by filename, orders groups deterministically by intent/weight, and dedupes identical lines", async () => {
		const fileA = "0 - draft/Real Estate - Lviv.md";
		const fileB = "1 - projects/Epoch/Epoch - To Do.md";

		const plugin: any = {
			indexer: {
				index: {
					"2026-02-10": [
						{ date: "2026-02-10", file: fileA, source: "tracked", trackedChange: "modified", summary: "Lviv Real Estate Commercial and Garage Listings Available", hidden: false, blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-10", file: fileA, source: "tracked", trackedChange: "modified", summary: "Lviv Real Estate Commercial and Garage Listings Available", hidden: false, blockStart: 10, blockEnd: 20 },
						{ date: "2026-02-10", file: fileA, source: "tracked", trackedChange: "added", summary: "Lviv Real Estate Commercial and Garage Listings Available", hidden: false, blockStart: 30, blockEnd: 40 },
						{ date: "2026-02-10", file: fileB, source: "tracked", trackedChange: "added", summary: "MacOS extra tab improvements aim to reduce context", hidden: false, blockStart: 0, blockEnd: 0 }
					],
					"2026-02-11": [
						{ date: "2026-02-11", file: fileA, source: "tracked", trackedChange: "modified", summary: "Lviv Real Estate Commercial and Garage Listings Available", hidden: false, blockStart: 1, blockEnd: 2 },
						{ date: "2026-02-11", file: fileB, source: "tracked", trackedChange: "modified", summary: "MacOS extra tab improvements aim to reduce context", hidden: false, blockStart: 1, blockEnd: 2 }
					]
				}
			}
		};

			const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-11"], "force", ["week"] as any);
		expect(jobs.length).toBeGreaterThan(0);

		const input = String((jobs[0] as any).input || "");
		const aPos = input.indexOf(`${fileA}:`);
		const bPos = input.indexOf(`${fileB}:`);
		expect(aPos).toBeGreaterThanOrEqual(0);
		expect(bPos).toBeGreaterThanOrEqual(0);
		expect(aPos).toBeLessThan(bPos);

		// The identical Edited line for fileA should appear only once.
		const editedLine = `- Edited Lviv Real Estate Commercial and Garage Listings Available`;
		expect(input.split(editedLine).length - 1).toBe(1);

		// Added and Edited should both be present.
		expect(input).toContain(`${fileA}:`);
		expect(input).toContain(`- Added Lviv Real Estate Commercial and Garage Listings Available`);
		expect(input).toContain(`${fileB}:`);
		expect(input).toContain(`- Added MacOS extra tab improvements aim to reduce context`);
		expect(input).toContain(`- Edited MacOS extra tab improvements aim to reduce context`);
	});

	it("applies epoch maxFileChars to non-long periods when the matching rule sets it", async () => {
		const file = "0 - draft/Short period cap.md";
		const plugin: any = {
			settings: {
				aiBridgeOptions: validateBridgeOptionsYaml([
					"epochs:",
					"  - period: day-month",
					"    maxFileChars: 40"
				].join("\n")).stored
			},
			indexer: {
				index: {
					"2026-02-10": [
						{ date: "2026-02-10", file, source: "tracked", trackedChange: "modified", summary: "First tracked line is long enough", hidden: false, blockStart: 0, blockEnd: 0 },
						{ date: "2026-02-10", file, source: "tracked", trackedChange: "modified", summary: "Second tracked line should be capped away", hidden: false, blockStart: 1, blockEnd: 2 }
					]
				}
			}
		};

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-10"], "force", ["day"] as any);
		expect(jobs.length).toBeGreaterThan(0);

		const input = String((jobs[0] as any).input || "");
		expect(input).toContain("First tracked line is long enough");
		expect(input).not.toContain("Second tracked line should be capped away");
	});

	it("uses the shared maxRelatedChars for epoch related payloads", async () => {
		const file = "seed.md";
		const plugin: any = {
			settings: {
				aiBridgeOptions: validateBridgeOptionsYaml([
					"maxRelatedChars: 60",
					"epochs:",
					"  - period: day-month",
					"    context: |",
					"      {{related}}"
				].join("\n")).stored
			},
			indexer: {
				index: {
					"2026-02-10": [
						{ date: "2026-02-10", file, source: "tracked", trackedChange: "modified", summary: "Seed epoch line", hidden: false, blockStart: 0, blockEnd: 0 }
					]
				},
				files: {
					"related.md": {
						cdate: null,
						namedDate: null,
						dateProp: null,
						contentDates: [
							{ date: "2026-02-09", file: "related.md", source: "content", summary: "Related summary that is intentionally longer than the shared cap", hidden: false, blockStart: 0, blockEnd: 0 }
						],
						trackedDates: {}
					}
				}
			},
			getSemanticRelatedScoredForFile: async () => ([{ path: "related.md", score: 0.9 }])
		};
		withTrustedPro(plugin);

		const jobs = await buildEpochJobsForDateKeys(plugin, ["2026-02-10"], "force", ["day"] as any);
		expect(jobs.length).toBeGreaterThan(0);

		const related = String((jobs[0] as any).related || "");
		expect(related).toContain("related.md");
		expect(related.length).toBeLessThanOrEqual(60);
	});
});
