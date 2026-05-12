import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

describe("Indexer: date-only line creates content-date record", () => {
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
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn()
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
	});

	const makeFile = (path: string, ctime: number): TFile => {
		const name = path.split("/").pop() ?? path;
		const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
		const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
		const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
		return new Ctor(path, { basename, extension, stat: { ctime, mtime: ctime, size: 0 } });
	};

	it("creates a content-date entry when the line is just 'April 23, 2026'", async () => {
		const file = makeFile("notes/memo.md", Date.UTC(2026, 0, 1));
		contents[file.path] = "April 23, 2026";
		await indexer.processFile(file, { reason: "modify" });
		const fileData = (indexer as any).files[file.path];
		const entry = (fileData?.contentDates ?? []).find((e: any) => e.date === "2026-04-23");
		expect(entry).toBeDefined();
	});

	it("creates a content-date entry when the line is just 'Apr 23 2026'", async () => {
		const file = makeFile("notes/memo.md", Date.UTC(2026, 0, 1));
		contents[file.path] = "Apr 23 2026";
		await indexer.processFile(file, { reason: "modify" });
		const fileData = (indexer as any).files[file.path];
		const entry = (fileData?.contentDates ?? []).find((e: any) => e.date === "2026-04-23");
		expect(entry).toBeDefined();
	});

	it("creates a content-date entry when the line is just '2026-04-23'", async () => {
		const file = makeFile("notes/memo.md", Date.UTC(2026, 0, 1));
		contents[file.path] = "2026-04-23";
		await indexer.processFile(file, { reason: "modify" });
		const fileData = (indexer as any).files[file.path];
		const entry = (fileData?.contentDates ?? []).find((e: any) => e.date === "2026-04-23");
		expect(entry).toBeDefined();
	});

	it("indexes all dates from the mixed 4-line sample", async () => {
		const file = makeFile("notes/memo.md", Date.UTC(2026, 0, 1));
		contents[file.path] = [
			"20260401-10h32",
			"02-Apr-26-10h32",
			"Apr 03, 2026",
			"April 04 2026"
		].join("\n");
		await indexer.processFile(file, { reason: "modify" });
		const fileData = (indexer as any).files[file.path];
		const dates = (fileData?.contentDates ?? []).map((e: any) => e.date);
		expect(dates).toEqual(["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]);
		const indexerAny: any = indexer as any;
		expect((indexerAny.index["2026-04-01"] ?? []).some((e: any) => e.file === file.path && e.source === "content")).toBe(true);
		expect((indexerAny.index["2026-04-02"] ?? []).some((e: any) => e.file === file.path && e.source === "content")).toBe(true);
		expect((indexerAny.index["2026-04-03"] ?? []).some((e: any) => e.file === file.path && e.source === "content")).toBe(true);
		expect((indexerAny.index["2026-04-04"] ?? []).some((e: any) => e.file === file.path && e.source === "content")).toBe(true);
	});

	it("keeps content-date entries and falls back to note name when summary length is disabled", async () => {
		pluginStub.settings.summaryWordsCount = 0;
		const file = makeFile("notes/memo.md", Date.UTC(2026, 0, 1));
		contents[file.path] = [
			"20260401-10h32",
			"02-Apr-26-10h32",
			"Apr 03, 2026",
			"April 04 2026"
		].join("\n");
		await indexer.processFile(file, { reason: "modify" });
		const fileData = (indexer as any).files[file.path];
		const dates = (fileData?.contentDates ?? []).map((e: any) => e.date);
		expect(dates).toEqual(["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]);
		const indexerAny: any = indexer as any;
		for (const dateKey of ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]) {
			const list = indexerAny.index[dateKey] ?? [];
			const entry = list.find((e: any) => e.file === file.path && e.source === "content");
			expect(entry).toBeTruthy();
			expect(String(entry.summary || "")).toBe("memo");
		}
	});
});
