import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

import { buildJobsForFile } from "../src/plugin/ai-summaries/file-jobs";
import { handleBridgeResult } from "../src/plugin/ai-summaries/result-handler";

function makeFile(path: string, ctime: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime,
			mtime: ctime,
			size: 0
		}
	});
}

describe("AI summary result applies to filename date-range range-day entries", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true,
				generateEpochs: false
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					adapter: {
						read: vi.fn(async (path: string) => contents[path] ?? "")
					},
					getAbstractFileByPath: vi.fn()
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] }))
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			},
			persistIndex: vi.fn().mockResolvedValue(undefined),
			refreshEpochViews: vi.fn(),
			queueVectorUpdate: vi.fn(),
			queueTermSimilarityUpdate: vi.fn()
		};
		indexer = new Indexer(pluginStub);
		pluginStub.indexer = indexer;
	});

	it("stores the AI summary on the clicked range-day contentDates entry", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("Daily/2026-01-01 2026-01-02.md", ctime);
		contents[file.path] = ["Line 1", "Line 2"].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const data = (indexer as any).files[file.path];
		expect(data?.namedDate?.source).toBe("namedate");
		expect(data?.namedDate?.date).toBe("2026-01-01");
		const rangeDay = (data?.contentDates ?? []).find((e: any) => e?.source === "namedate" && e?.date === "2026-01-02");
		expect(rangeDay).toBeTruthy();

		const built = await buildJobsForFile(pluginStub, file.path, false);
		const anchorJob = built.jobs.find((j: any) => j?.groupType === "anchor");
		expect(anchorJob).toBeTruthy();
		if (!anchorJob) throw new Error("Expected anchor-group job for filename date-range");

		expect(Array.isArray((anchorJob as any).targets)).toBe(true);
		const kinds = ((anchorJob as any).targets ?? []).map((t: any) => t?.kind);
		expect(kinds.length).toBeGreaterThan(0);
		expect(kinds.includes("namedDate")).toBe(true);
		expect(kinds.includes("content")).toBe(true);

		handleBridgeResult(pluginStub, anchorJob as any, { summary: "RANGE SUMMARY" });

		const updated = (data?.contentDates ?? []).find((e: any) => e?.source === "namedate" && e?.date === "2026-01-02");
		expect(updated?.aiSummary).toBe("RANGE SUMMARY");
		expect(data?.namedDate?.aiSummary).toBe("RANGE SUMMARY");

		// The aggregated index entry for the range day should use the AI summary when enabled.
		const list: any[] = ((indexer as any).index["2026-01-02"] ?? []) as any[];
		const agg = list.find((e) => e && e.file === file.path && e.source === "namedate" && e.date === "2026-01-02");
		expect(agg?.summary).toBe("RANGE SUMMARY");
	});
});
