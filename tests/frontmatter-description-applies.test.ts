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

describe("Frontmatter description applies", () => {
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
			hasProAccess: () => true,
			hasRecurringAccess: () => true,
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

	it("prefers YAML description over note body for content date summaries", async () => {
		const file = makeFile("folder/desc-content.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"description: Desc wins",
			"---",
			"Met on 2026-03-05 for lunch"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { description: "Desc wins" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const list: any[] = ((indexer as any).index["2026-03-05"] ?? []) as any[];
		const entry = list.find((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter !== true && e.recurring !== true);
		expect(entry?.summary).toBe("Desc wins");
	});

	it("uses YAML description for dateprop anchor when the note body is empty", async () => {
		const file = makeFile("folder/desc-frontmatter-only.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"date: 2026-03-14",
			"description: Desc wins",
			"---"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-14", description: "Desc wins" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer as any).index["2026-03-14"] ?? []) as any[];
		const anchor = list.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchor?.summary).toBe("Desc wins");
	});

	it("prefers YAML description over note body for frontmatter-derived content date summaries", async () => {
		const file = makeFile("folder/desc-frontmatter-token.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"description: Desc wins",
			"due: 2026-03-05",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { description: "Desc wins", due: "2026-03-05" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const list: any[] = ((indexer as any).index["2026-03-05"] ?? []) as any[];
		const entry = list.find((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true);
		expect(entry?.summary).toBe("Desc wins");
	});

	it("prefers YAML description over note body for recurring synthetic summaries", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0, 0));
		try {
			const file = makeFile("folder/desc-repeat.md", Date.UTC(2026, 2, 1));
			contents[file.path] = [
				"---",
				"description: Desc wins",
				"repeat: every day from 2026-03-01 count 2",
				"---",
				"Body"
			].join("\n");

			(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
				frontmatter: { description: "Desc wins", repeat: "every day from 2026-03-01 count 2" },
				tags: []
			}));

			await indexer.processFile(file, { reason: "modify" });

			for (const k of ["2026-03-01", "2026-03-02"]) {
				const list: any[] = ((indexer as any).index[k] ?? []) as any[];
				const entry = list.find((e) => e && e.file === file.path && e.recurring === true);
				expect(entry?.summary).toBe("Desc wins");
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it("prefers YAML description over note body for dateprop anchor summaries", async () => {
		const file = makeFile("folder/desc-dateprop.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"date: 2026-03-14",
			"description: Desc wins",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-14", description: "Desc wins" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer as any).index["2026-03-14"] ?? []) as any[];
		const anchor = list.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchor?.summary).toBe("Desc wins");
	});

	it("prefers YAML description over note body for filename date-range range-day summaries", async () => {
		const file = makeFile("folder/2026-03-10 2026-03-11.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"description: Desc wins",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { description: "Desc wins" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer as any).index["2026-03-11"] ?? []) as any[];
		const entry = list.find((e) => e && e.file === file.path && e.source === "namedate" && e.date === "2026-03-11");
		expect(entry?.summary).toBe("Desc wins");
	});

	it("prefers YAML description over note body even when Auto summarize is enabled", async () => {
		contents = {};
		const plugin2: any = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true,
				parseDatesInFrontmatter: true
			},
			hasProAccess: () => true,
			hasRecurringAccess: () => true,
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
		const indexer2 = new Indexer(plugin2);

		const file = makeFile("folder/desc-dateprop-autoai.md", Date.UTC(2026, 2, 1));
		contents[file.path] = [
			"---",
			"date: 2026-03-14",
			"description: Desc wins",
			"---",
			"Body should not win"
		].join("\n");

		(plugin2.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-14", description: "Desc wins" },
			tags: []
		}));

		await indexer2.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer2 as any).index["2026-03-14"] ?? []) as any[];
		const anchor = list.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchor?.summary).toBe("Desc wins");
	});

	it("overrides tracked change summaries with YAML description", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 14, 12, 0, 0, 0));
		try {
			pluginStub.settings.trackChanges = true;
			const file = makeFile("folder/desc-tracked.md", Date.UTC(2026, 2, 1));
			contents[file.path] = [
				"---",
				"description: this is my, not your note",
				"---",
				"Alpha"
			].join("\n");

			(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
				frontmatter: { description: "this is my, not your note" },
				tags: []
			}));

			await indexer.processFile(file, { reason: "modify" });
			contents[file.path] = [
				"---",
				"description: this is my, not your note",
				"---",
				"Beta"
			].join("\n");
			await indexer.processFile(file, { reason: "modify" });

			const list: any[] = ((indexer as any).index["2026-03-14"] ?? []) as any[];
			const entry = list.find((e) => e && e.file === file.path && e.source === "tracked");
			expect(entry?.summary).toBe("this is my, not your note");
			expect(String(entry?.summary ?? "")).not.toMatch(/Alpha|Beta/);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps tracked AI summaries visible during re-aggregation without cached lines", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 14, 12, 0, 0, 0));
		try {
			const plugin2: any = {
				settings: {
					trackChanges: true,
					summaryWordsCount: 8,
					summarizeAI: true,
					parseDatesInFrontmatter: true
				},
				hasProAccess: () => true,
				hasRecurringAccess: () => true,
				app: {
					vault: {
						read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
						getAbstractFileByPath: vi.fn((path: string) => (path ? makeFile(path, Date.UTC(2026, 2, 1)) : null))
					},
					metadataCache: {
						getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] }))
					},
					workspace: {
						getActiveViewOfType: vi.fn()
					}
				}
			};
			const indexer2 = new Indexer(plugin2);

			const file = makeFile("folder/desc-tracked-reagg.md", Date.UTC(2026, 2, 1));
			contents[file.path] = [
				"---",
				"description: Desc wins",
				"---",
				"Alpha"
			].join("\n");
			(plugin2.app.metadataCache.getFileCache as any).mockImplementation(() => ({
				frontmatter: { description: "Desc wins" },
				tags: []
			}));
			(plugin2.app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => (path === file.path ? file : null));

			await indexer2.processFile(file, { reason: "modify" });
			contents[file.path] = [
				"---",
				"description: Desc wins",
				"---",
				"Beta"
			].join("\n");
			await indexer2.processFile(file, { reason: "modify" });

			const dateKey = "2026-03-14";
			const fileData: any = (indexer2 as any).files[file.path];
			const trackedList: any[] = fileData?.trackedDates?.[dateKey] ?? [];
			expect(trackedList.length).toBeGreaterThan(0);
			for (const e of trackedList) {
				e.aiSummary = "TRACKED AI";
				e.aiSummaryInputHash = "stale-ok";
				e.aiSummaryVisible = true;
			}

			// Simulate later re-aggregation when `latestLines` have been dropped.
			delete (indexer2 as any).latestLines?.[file.path];
			(indexer2 as any).updateAggregatedEntries(file.path);

			const list: any[] = ((indexer2 as any).index[dateKey] ?? []) as any[];
			const tracked = list.find((e) => e && e.file === file.path && e.source === "tracked");
			expect(tracked?.summary).toBe("Desc wins");
		} finally {
			vi.useRealTimers();
		}
	});
});
