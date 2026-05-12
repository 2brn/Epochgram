import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

function makeFile(path: string, ctime: number, mtime?: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime,
			mtime: mtime ?? ctime,
			size: 0
		}
	});
}

describe("Frontmatter suppression flags", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 8
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn((p: string) => makeFile(p, Date.UTC(2026, 0, 1)))
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

	it("notracked suppresses tracked-change indexing", async () => {
		const path = "folder/notracked.md";
		const file1 = makeFile(path, Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 1));
		contents[path] = [
			"---",
			"notracked: 1",
			"---",
			"First version"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { notracked: "1" },
			tags: []
		}));

		await indexer.processFile(file1, { reason: "modify" });

		const file2 = makeFile(path, Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 2));
		contents[path] = [
			"---",
			"notracked: true",
			"---",
			"Second version with changes"
		].join("\n");

		await indexer.processFile(file2, { reason: "modify" });

		const fileData = (indexer as any).files[path];
		expect(Object.keys(fileData?.trackedDates ?? {})).toEqual([]);

		const allEntries = Object.values((indexer as any).index ?? {}).flat();
		expect(allEntries.some((e: any) => e && e.file === path && e.source === "tracked")).toBe(false);
	});

	it("noparsed suppresses parsed content-date indexing", async () => {
		const path = "folder/noparsed.md";
		const file = makeFile(path, Date.UTC(2026, 2, 1));
		contents[path] = [
			"---",
			"noparsed: whatever",
			"---",
			"Meet on 2026-03-05 with team"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { noparsed: "whatever" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const list: any[] = ((indexer as any).index["2026-03-05"] ?? []) as any[];
		const contentEntry = list.find((e) => e && e.file === path && e.source === "content" && e.recurring !== true);
		expect(contentEntry).toBeFalsy();
	});
});
