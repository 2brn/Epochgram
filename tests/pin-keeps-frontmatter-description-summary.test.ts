import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
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

describe("Pin keeps summary stable", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: false,
				parseDatesInFrontmatter: true
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
			}
		};
		indexer = new Indexer(pluginStub);
	});

	it("does not regress after pin re-aggregation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 14, 12, 0, 0, 0));
		try {
			const file = makeFile("folder/note.md", Date.UTC(2026, 2, 1));
			contents[file.path] = [
				"---",
				"date: 2026-03-10",
				"description: Desc wins",
				"---",
				"Body starts here and should not win"
			].join("\n");

			(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
				frontmatter: { date: "2026-03-10", description: "Desc wins" },
				tags: []
			}));

			await indexer.processFile(file, { reason: "modify" });
			const before = (indexer as any).index["2026-03-10"]?.find((e: any) => e.file === file.path && e.source === "dateprop");
			expect(before?.summary).toBe("Desc wins");

			indexer.setFilePinned(file.path, true);
			const pinned = (indexer as any).index["2026-03-14"]?.find(
				(e: any) => e.file === file.path && e.pinned === true && e.originalDate === "2026-03-10"
			);
			expect(pinned?.summary).toBe("Desc wins");
		} finally {
			vi.useRealTimers();
		}
	});
});
