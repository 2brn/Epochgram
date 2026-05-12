import { describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { searchMethods } from "../src/plugin/search";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
import { TFile } from "obsidian";

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

describe("Timeline search indexes frontmatter (including date)", () => {
	it("indexes arbitrary frontmatter keys/values including the date key", async () => {
		const ctime = Date.UTC(2026, 1, 20);
		const file = makeFile("folder/note.md", ctime);

		const contents: Record<string, string> = {
			[file.path]: [
				"---",
				"date: 2099-12-31",
				"status: done",
				"project: Alpha",
				"nested:",
				"  inner: Zeta",
				"---",
				"",
				"Hello body"
			].join("\n")
		};

		const pluginStub: any = {
			__timelineSearchIndexVersion: 0,
			timelineSearchIndex: new TimelineSearchIndex(),
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				similarityZeroShotMinScore: 0
			},
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn()
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({
						frontmatter: {
							date: "2099-12-31",
							status: "done",
							project: "Alpha",
							nested: { inner: "Zeta", date: "2099-12-30" }
						},
						tags: []
					}))
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			},
			hasProAccess: () => true
		};

		const indexer = new Indexer(pluginStub);
		await indexer.processFile(file, { reason: "modify" });

		const idx = pluginStub.timelineSearchIndex as TimelineSearchIndex;

		expect(
			idx.searchFileIds({
				includeText: "done",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "Alpha",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "Zeta",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "Hello",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "2099-12-31",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "2099-12-30",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);
	});

	it("rebuildTimelineSearchIndex also indexes frontmatter (including date)", async () => {
		const ctime = Date.UTC(2026, 1, 20);
		const file = makeFile("folder/rebuild.md", ctime);

		const contents: Record<string, string> = {
			[file.path]: [
				"---",
				"date: 2099-12-31",
				"status: done",
				"project: Alpha",
				"---",
				"",
				"Body"
			].join("\n")
		};

		const pluginStub: any = {
			timelineSearchIndex: new TimelineSearchIndex(),
			settings: {
				similarityZeroShotMinScore: 0
			},
			indexer: {
				getIndexedPaths: () => [file.path],
				getFileIndexData: () => ({}),
				getFileEmbeddingTerm: () => ""
			},
			ensureIndexLoaded: vi.fn(async () => {}),
			waitForExcludedSync: vi.fn(async () => {}),
			shouldIndexFile: vi.fn(() => true),
			refreshEpochViews: vi.fn(() => {}),
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn(() => file)
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({
						frontmatter: { date: "2099-12-31", status: "done", project: "Alpha" },
						tags: []
					}))
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};

		await searchMethods.rebuildTimelineSearchIndex.call(pluginStub);

		const idx = pluginStub.timelineSearchIndex as TimelineSearchIndex;
		expect(
			idx.searchFileIds({
				includeText: "done",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "Alpha",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);

		expect(
			idx.searchFileIds({
				includeText: "2099-12-31",
				exactPhrases: [],
				excludedPhrases: [],
				excludeTokens: []
			}).has(file.path)
		).toBe(true);
	});
});
