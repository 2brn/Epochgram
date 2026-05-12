import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { TFile } from "obsidian";
import { buildJobsForFile } from "../src/plugin/ai-summaries/file-jobs";

describe("AI summaries for text files", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true
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
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
		pluginStub.indexer = indexer;
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

	it("indexes and builds summary jobs for .txt", async () => {
		const ctime = Date.UTC(2025, 0, 5);
		const file = makeFile("folder/log.txt", ctime);
		contents[file.path] = "2025-01-04 did something\nmore text";

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.date).toBe(dateKey);
		expect(Array.isArray(fileData?.contentDates)).toBe(true);
		expect(fileData.contentDates.length).toBeGreaterThan(0);

		const built = await buildJobsForFile(pluginStub, file.path, true);
		expect(built.jobs.length).toBeGreaterThan(0);
	});
});
