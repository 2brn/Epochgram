import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { dateFrontmatterMethods } from "../src/plugin/date-frontmatter";
import type { FileDateEntry } from "../src/indexer/types";
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

describe("Frontmatter dateprop", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
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

	it("extracts frontmatter date as dateprop but does not also index it as a parsed/content date", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/note.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"due: 2025-01-04",
			"tags: [x]",
			"---",
			"",
			"Body mentions 2025-01-03 in text"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2025-01-02", due: "2025-01-04", nested: { date: "2025-01-05" } },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.dateProp?.source).toBe("dateprop");
		expect(fileData?.dateProp?.date).toBe("2025-01-02");

		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-02" && (e as any).fromFrontmatter === true)).toBe(false);
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-03")).toBe(true);
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-04")).toBe(true);
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-05")).toBe(true);
	});

	it("prefers namedate over dateprop for anchor entry", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/2025-01-10 note.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2025-01-02" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.namedDate?.source).toBe("namedate");
		expect(fileData?.namedDate?.date).toBe("2025-01-10");
		expect(fileData?.dateProp?.source).toBe("dateprop");
		expect(fileData?.dateProp?.date).toBe("2025-01-02");

		expect(((indexer as any).index["2025-01-10"] ?? []).some((e: any) => e.file === file.path && e.source === "namedate")).toBe(true);
		expect(((indexer as any).index["2025-01-02"] ?? []).some((e: any) => e.file === file.path && e.source === "dateprop")).toBe(false);
		expect(((indexer as any).index["2025-01-02"] ?? []).some((e: any) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true)).toBe(false);
	});

	it("keeps frontmatter-only parsed date entries (non-anchor keys) even with trailing blank lines", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/frontmatter-only.md", ctime);

		contents[file.path] = ["---", "date: 2025-01-02", "due: 2025-01-04", "---", "", ""].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2025-01-02", due: "2025-01-04" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		expect(((indexer as any).index["2025-01-02"] ?? []).some((e: any) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true)).toBe(false);
		expect(((indexer as any).index["2025-01-04"] ?? []).some((e: any) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true)).toBe(true);
	});

	it("uses custom date property key for dateprop and excludes it from parsed frontmatter dates", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/custom-date-key.md", ctime);

		(pluginStub.settings as any).yamlDateProperty = "anchor";
		contents[file.path] = [
			"---",
			"anchor: 2025-01-06",
			"due: 2025-01-08",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { anchor: "2025-01-06", due: "2025-01-08" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.dateProp?.source).toBe("dateprop");
		expect(fileData?.dateProp?.date).toBe("2025-01-06");

		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-06" && (e as any).fromFrontmatter === true)).toBe(false);
		expect(contentDates.some(e => e.source === "content" && e.date === "2025-01-08" && (e as any).fromFrontmatter === true)).toBe(true);
	});

	it("does not keep stale dateprop when metadata cache still reports removed frontmatter", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/somenote.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2025-01-02" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = "Body without frontmatter";
		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2025-01-02" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "rebuild" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.dateProp).toBeNull();
		expect(((indexer as any).index["2025-01-02"] ?? []).some((e: any) => e.file === file.path && e.source === "dateprop")).toBe(false);
		expect(((indexer as any).index["2025-01-01"] ?? []).some((e: any) => e.file === file.path && e.source === "cdate")).toBe(true);
	});

	it("ignores conflicting top-level metadata-cache date normalization for scalar YAML fields", async () => {
		const ctime = Date.UTC(2026, 4, 21);
		const file = makeFile("folder/21-05-2026.md", ctime);

		contents[file.path] = [
			"---",
			"published: 23-05-2026",
			"description: PKM",
			"---",
			"",
			"[Personal knowledge management](https://en.wikipedia.org/wiki/Personal_knowledge_management)"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: {
				published: new Date(Date.UTC(2026, 4, 20, 21, 0, 0)),
				description: "PKM"
			},
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		expect(contentDates.filter(e => e.source === "content" && (e as any).fromFrontmatter === true).map(e => e.date)).toEqual(["2026-05-23"]);
		expect(((indexer as any).index["2026-05-20"] ?? []).some((e: any) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true)).toBe(false);
		expect(((indexer as any).index["2026-05-23"] ?? []).some((e: any) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true)).toBe(true);
	});

	it("preserves AI summaries during move-to-file", async () => {
		const file = makeFile("2026-05-18.md");
		let raw = ["---", "date: 2026-05-18", "---", "Body"].join("\n");

		const plugin: any = {
			app: {
				vault: {
					read: vi.fn(async () => raw),
					modify: vi.fn(async (_file: TFile, next: string) => {
						raw = next;
					}),
					getAbstractFileByPath: vi.fn((path: string) => (path === file.path ? file : null))
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: { date: "2026-05-18" }, tags: [] }))
				}
			},
			ensureIndexLoaded: vi.fn(async () => {}),
			waitForExcludedSync: vi.fn(async () => {}),
			shouldIndexFile: vi.fn(() => true),
			setYamlDateForPath: vi.fn(async () => true),
			refreshEpochViews: vi.fn()
		};

		const changed = await dateFrontmatterMethods.setYamlDateForFile.call(plugin, file, "2026-05-19");

		expect(changed).toBe(true);
		expect(raw).toBe(["---", "date: 2026-05-19", "---", "Body"].join("\n"));
		expect(plugin.refreshEpochViews).toHaveBeenCalledTimes(1);
	});
});
