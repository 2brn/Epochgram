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

describe("Filename date range anchor", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8
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

	it("uses fromDate as anchor and does not add cdate day", async () => {
		// Repro: filename has an explicit date range, but the file is created on the next day.
		const ctime = Date.UTC(2026, 2, 9); // 2026-03-09
		const file = makeFile("Skitour - Драгобрат 2026-03-06 ... 2026-03-08.md", ctime);
		contents[file.path] = "";

		await indexer.processFile(file, { reason: "create" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.namedDate?.source).toBe("namedate");
		expect(fileData?.namedDate?.date).toBe("2026-03-06");

		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const hasFileOn = (dateKey: string): boolean => (idx[dateKey] ?? []).some((e: any) => e.file === file.path);

		expect(hasFileOn("2026-03-06")).toBe(true);
		expect(hasFileOn("2026-03-07")).toBe(true);
		expect(hasFileOn("2026-03-08")).toBe(true);
		expect(hasFileOn("2026-03-09")).toBe(false);
	});
});
