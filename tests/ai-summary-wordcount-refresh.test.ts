import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { computeAiSummaryInputHash } from "../src/utils";
import { TFile } from "obsidian";

function words(n: number): string {
	return Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");
}

describe("AI summary uses word count after refresh", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 5,
				summarizeAI: true
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

	it("keeps using stored AI summary and re-truncates when summaryWordsCount changes", async () => {
		const ctime = Date.UTC(2025, 11, 26);
		const file = makeFile("folder/note.md", ctime);
		contents[file.path] = "# Title\n\n" + words(200);

		await indexer.processFile(file, { reason: "modify" });
		const dateKey = normalizeDateFromTimestamp(ctime);

		// Store an AI summary for the anchor (cdate) entry.
		const aiRaw = words(30);
		const fullText = contents[file.path];
		const fileData = (indexer as any).files[file.path];
		fileData.cdate.aiSummary = aiRaw;
		fileData.cdate.aiSummaryInputHash = computeAiSummaryInputHash(file.path, "anchor", fullText, 24000);

		(indexer as any).latestLines[file.path] = fullText.split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const first = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(first?.summary).toBe(words(5) + "...");

		// Change word count and simulate a refresh/reprocess (as settings change would do).
		pluginStub.settings.summaryWordsCount = 10;
		await indexer.processFile(file, { reason: "rebuild" });

		const after = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(after?.summary).toBe(words(10) + "...");
	});
});
