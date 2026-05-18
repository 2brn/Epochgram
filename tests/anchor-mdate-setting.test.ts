import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

function makeFile(path: string, ctime: number, mtime: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime,
			mtime,
			size: 0
		}
	});
}

describe("Anchor by mdate setting", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				anchorMdate: false
			},
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? "")
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

	it("uses ctime by default and switches to mtime when enabled", async () => {
		const ctime = Date.UTC(2026, 0, 3);
		const mtime = Date.UTC(2026, 0, 12);
		const file = makeFile("Notes/anchor-source.md", ctime, mtime);
		contents[file.path] = "";

		await indexer.processFile(file, { reason: "create" });
		let fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.source).toBe("cdate");
		expect(fileData?.cdate?.date).toBe("2026-01-03");
		expect(fileData?.anchorUsesMdate).toBe(false);

		pluginStub.settings.anchorMdate = true;
		await indexer.processFile(file, { reason: "modify" });
		fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.source).toBe("cdate");
		expect(fileData?.cdate?.date).toBe("2026-01-12");
		expect(fileData?.anchorUsesMdate).toBe(true);
	});
});
