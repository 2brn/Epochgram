import { describe, it, expect } from "vitest";
import { buildRelatedSummariesAllDates } from "../src/plugin/ai-summaries/related";

function mkEntry(args: {
	date: string;
	file: string;
	source: "content" | "tracked" | "cdate" | "namedate" | "dateprop";
	summary?: string;
	aiSummary?: string;
	blockStart?: number;
	blockEnd?: number;
	trackedTime?: string;
}): any {
	return {
		date: args.date,
		file: args.file,
		source: args.source,
		summary: args.summary ?? "",
		aiSummary: args.aiSummary ?? "",
		blockStart: args.blockStart ?? 0,
		blockEnd: args.blockEnd ?? 0,
		trackedTime: args.trackedTime
	};
}

describe("related context (all dates)", () => {
	it("groups by full path and sorts groups + items newest-first", () => {
		const plugin: any = {
			indexer: {
				files: {
					"z/older.md": {
						cdate: null,
						namedDate: null,
						contentDates: [
							mkEntry({ date: "2026-01-01", file: "z/older.md", source: "content", summary: "fact z1" }),
							mkEntry({ date: "2026-01-02", file: "z/older.md", source: "content", summary: "fact z2" })
						],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null
					},
					"a/newer.md": {
						cdate: null,
						namedDate: null,
						contentDates: [
							mkEntry({ date: "2026-01-05", file: "a/newer.md", source: "content", summary: "fact a1" }),
							mkEntry({ date: "2026-01-03", file: "a/newer.md", source: "content", summary: "fact a2" })
						],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null
					}
				}
			}
		};

		const relatedScored = [
			{ path: "z/older.md", score: 0.9 },
			{ path: "a/newer.md", score: 0.8 }
		];

		const out = buildRelatedSummariesAllDates(plugin, relatedScored, {
			maxFiles: 8,
			maxEntriesPerFile: 10,
			maxSummaryChars: 200,
			maxTotalChars: 9999
		});

		// Group ordering: a/newer.md has newest date 2026-01-05, so it should come first.
		expect(out.indexOf("  - a/newer.md:\n")).toBeGreaterThanOrEqual(0);
		expect(out.indexOf("  - z/older.md:\n")).toBeGreaterThanOrEqual(0);
		expect(out.indexOf("  - a/newer.md:\n")).toBeLessThan(out.indexOf("  - z/older.md:\n"));

		// Item ordering within group: newest-first.
		const aBlockStart = out.indexOf("  - a/newer.md:\n");
		const aBlockEnd = out.indexOf("\n  - z/older.md:\n");
		const aBlock = out.slice(aBlockStart, aBlockEnd);
		expect(aBlock.indexOf("    - fact a1")).toBeLessThan(aBlock.indexOf("    - fact a2"));

		const zBlockStart = out.indexOf("  - z/older.md:\n");
		const zBlock = out.slice(zBlockStart);
		expect(zBlock.indexOf("    - fact z2")).toBeLessThan(zBlock.indexOf("    - fact z1"));
	});
});
