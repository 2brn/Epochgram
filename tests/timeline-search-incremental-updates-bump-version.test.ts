import { describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
import { TFile } from "obsidian";

function makeFile(path: string, ctime: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (
		path: string,
		options?: Partial<TFile>
	) => TFile;
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

describe("Timeline search incremental updates", () => {
	it("bumps __timelineSearchIndexVersion when a file is processed", async () => {
		const ctime = Date.UTC(2026, 1, 19);
		const file = makeFile("folder/note.md", ctime);
		const contents: Record<string, string> = {
			[file.path]: "виключно редакція."
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
					getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] }))
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			},
			hasProAccess: () => true
		};

		const indexer = new Indexer(pluginStub);
		await indexer.processFile(file, { reason: "modify" });

		expect(Number(pluginStub.__timelineSearchIndexVersion)).toBe(1);

		const matches = pluginStub.timelineSearchIndex.searchFileIds({
			includeText: "виключно редакції.",
			exactPhrases: [],
			excludedPhrases: [],
			excludeTokens: []
		});
		expect(matches.has(file.path)).toBe(true);
	});
});
