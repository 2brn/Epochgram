import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { resolveFrontmatterSuppressionFlags } from "../src/indexer/frontmatter-flags";
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
				summaryWordsCount: 8
			},
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

	it.each(["noparsed", "nodates"])("%s suppresses parsed content-date indexing", async (flag) => {
		const path = `folder/${flag}.md`;
		const file = makeFile(path, Date.UTC(2026, 2, 1));
		contents[path] = [
			"---",
			`${flag}: whatever`,
			"---",
			"Meet on 2026-03-05 with team"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { [flag]: "whatever" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const list: any[] = ((indexer as any).index["2026-03-05"] ?? []) as any[];
		const contentEntry = list.find((e) => e && e.file === path && e.source === "content" && e.recurring !== true);
		expect(contentEntry).toBeFalsy();
	});

	it("nodates suppresses parsed content dates when metadata is stale", () => {
		const flags = resolveFrontmatterSuppressionFlags({}, "folder/nodates.md", [
			"---",
			"nodates: true",
			"---",
			"Meet on 2026-03-05 with team"
		].join("\n"));

		expect(flags.noparsed).toBe(true);
	});
});
