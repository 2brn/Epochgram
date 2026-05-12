import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { TFile } from "obsidian";
import { computeAiSummaryInputHash } from "../src/utils";

describe("AI summary timeline visibility gating", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 12,
				summarizeAI: false
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn()
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
	});

	const makeFile = (path: string, ctime: number): TFile => {
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
	};

	it("does not use aiSummary for timeline summary when Auto summarize is off and aiSummaryVisible is false", async () => {
		const ctime = Date.UTC(2025, 0, 5);
		const file = makeFile("folder/note.md", ctime);
		contents[file.path] = "# Heading\nThis is the baseline text.";
		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const before = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(String(before?.summary ?? "").trim().length).toBeGreaterThan(0);

		const fileData = (indexer as any).files[file.path];
		const aiSummary = "AI SHOULD NOT DISPLAY";
		const fullText = contents[file.path];
		fileData.cdate.aiSummary = aiSummary;
		fileData.cdate.aiSummaryInputHash = computeAiSummaryInputHash(file.path, "anchor", fullText, 24000);
		fileData.cdate.aiSummaryVisible = false;

		(indexer as any).latestLines[file.path] = fullText.split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const after = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(after?.summary).toBe(before?.summary);
		expect(after?.summary).not.toBe(aiSummary);
	});

	it("uses aiSummary for timeline summary when aiSummaryVisible is true (even if Auto summarize is off)", async () => {
		const ctime = Date.UTC(2025, 0, 6);
		const file = makeFile("folder/note2.md", ctime);
		contents[file.path] = "# Heading\nMore baseline text.";
		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const fileData = (indexer as any).files[file.path];
		const aiSummary = "AI SUMMARY WINS";
		const fullText = contents[file.path];
		fileData.cdate.aiSummary = aiSummary;
		fileData.cdate.aiSummaryInputHash = computeAiSummaryInputHash(file.path, "anchor", fullText, 24000);
		fileData.cdate.aiSummaryVisible = true;

		(indexer as any).latestLines[file.path] = fullText.split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const after = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(after?.summary).toBe(aiSummary);
	});
});
