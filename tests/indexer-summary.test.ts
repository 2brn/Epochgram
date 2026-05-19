import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { makeSummary } from "../src/indexer/summarizer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { resolveSummaryForEntry, resolveSummaryForFile } from "../src/indexer/summary-helpers";
import { computeAiSummaryInputHash } from "../src/utils";
import { TFile } from "obsidian";
import type { FileDateEntry } from "../src/indexer/types";

describe("Indexer anchor summaries", () => {
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
	};

	it("summarizes cdate content without filename prefix", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/daily.md", ctime);
		contents[file.path] = "# Heading\nMorning update";

		await indexer.processFile(file, { reason: "modify" });

		const expected = makeSummary(contents[file.path], pluginStub.settings.summaryWordsCount);

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.summary).toBe(expected);

		const dateKey = normalizeDateFromTimestamp(ctime);
		const aggregated = indexer.index[dateKey]?.find(entry => entry.file === file.path);
		expect(aggregated?.summary).toBe(expected);
	});

	it("treats yaml-only date notes as empty and falls back to filename", () => {
		pluginStub.settings.summaryWordsCount = 7;
		const path = "Daily/2026-03-14.md";
		const text = "---\ndate: 2026-03-14\n---\n";
		const out = resolveSummaryForFile(pluginStub, path, text, { includeFileName: false });
		expect(out).toBe("2026-03-14");
	});

	it("updates anchor summary after rename without filename prefix", async () => {
		const ctime = Date.UTC(2025, 0, 2);
		const file = makeFile("folder/log.md", ctime);
		contents[file.path] = "Initial content line";

		await indexer.processFile(file, { reason: "modify" });

		const renamedPath = "folder/renamed-log.md";
		const renamedFile = makeFile(renamedPath, ctime);
		contents[renamedPath] = contents[file.path];

		pluginStub.app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === renamedFile.path) return renamedFile;
			return null;
		});

		await indexer.renameFile(file.path, renamedFile.path);

		const expected = makeSummary(contents[renamedFile.path], pluginStub.settings.summaryWordsCount);

		const renamedData = (indexer as any).files[renamedFile.path];
		expect(renamedData?.cdate?.summary).toBe(expected);

		const dateKey = normalizeDateFromTimestamp(ctime);
		const aggregated = indexer.index[dateKey]?.find(entry => entry.file === renamedFile.path);
		expect(aggregated?.summary).toBe(expected);
		expect((indexer as any).files[file.path]).toBeUndefined();
	});

	it("recomputes namedate anchor on rename when content is unchanged", async () => {
		const ctime = Date.UTC(2026, 4, 22);
		const oldPath = "daily-22-05-2026.md";
		const newPath = "daily-23-05-2026.md";
		const file = makeFile(oldPath, ctime);
		contents[oldPath] = "Same body";

		await indexer.processFile(file, { reason: "modify" });

		const renamedFile = makeFile(newPath, ctime);
		contents[newPath] = contents[oldPath];
		pluginStub.app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === renamedFile.path) return renamedFile;
			return null;
		});

		await indexer.renameFile(oldPath, newPath);

		const renamedData = (indexer as any).files[newPath];
		expect(renamedData?.namedDate?.date).toBe("2026-05-23");
		expect(((indexer as any).index["2026-05-22"] ?? []).some((e: any) => e.file === newPath && e.source === "namedate")).toBe(false);
		expect(((indexer as any).index["2026-05-23"] ?? []).some((e: any) => e.file === newPath && e.source === "namedate")).toBe(true);
	});

	it("summarizes content without filename/separator", async () => {
		pluginStub.settings.summaryWordsCount = 3;
		const ctime = Date.UTC(2025, 0, 3);
		const file = makeFile("folder/daily.md", ctime);
		contents[file.path] = "First second third fourth";

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const aggregated = indexer.index[dateKey]?.find(entry => entry.file === file.path);
		const expected = makeSummary(contents[file.path], pluginStub.settings.summaryWordsCount);
		expect(aggregated?.summary).toBe(expected);
	});

	it("strips date literals from merged content summaries even after re-aggregation without latestLines", async () => {
		pluginStub.settings.summaryWordsCount = 50;
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("Diary.md", ctime);
		contents[file.path] = [
			"---",
			"date: 2026-03-17",
			"notracked:",
			"---",
			"2026-03-17",
			"\u041c\u043e\u044f \u0448\u043a\u0456\u0440\u044f\u043d\u0430 \u043a\u0443\u0440\u0442\u043a\u0430 Hein Gericke \u043f\u043e\u0432\u0435\u0440\u043d\u0443\u043b\u0430\u0441\u044c \u0447\u0435\u0442\u0432\u0435\u0440\u0442\u0438\u0439 \u0440\u0430\u0437 \u0432\u0456\u0434 \u043f\u043e\u043a\u0443\u043f\u0446\u044f"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const fileData: any = (indexer as any).files[file.path];
		const stored = (fileData?.contentDates ?? []).find(
			(e: any) => e && e.source === "content" && String(e.date || "") === "2026-03-17"
		);
		expect(stored).toBeTruthy();
		expect(String(stored?.summary ?? "")).not.toContain("2026-03-17");
		expect(String(stored?.summary ?? "")).toContain("\u041c\u043e\u044f \u0448\u043a\u0456\u0440\u044f\u043d\u0430 \u043a\u0443\u0440\u0442\u043a\u0430");

		// Simulate later re-aggregation when `latestLines` have been dropped.
		delete (indexer as any).latestLines?.[file.path];
		(indexer as any).updateAggregatedEntries(file.path);

		const list: any[] = ((indexer as any).index["2026-03-17"] ?? []) as any[];
		const contentEntry = list.find((e) => e && e.file === file.path && e.source === "content");
		expect(String(contentEntry?.summary ?? "")).not.toContain("2026-03-17");
		expect(String(contentEntry?.summary ?? "")).toContain("\u041c\u043e\u044f \u0448\u043a\u0456\u0440\u044f\u043d\u0430 \u043a\u0443\u0440\u0442\u043a\u0430");
	});

	it("truncates without leaving separator artifacts", async () => {
		pluginStub.settings.summaryWordsCount = 1;
		const ctime = Date.UTC(2025, 0, 4);
		const file = makeFile("folder/daily.md", ctime);
		contents[file.path] = "First second";

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const aggregated = indexer.index[dateKey]?.find(entry => entry.file === file.path);
		const expected = makeSummary(contents[file.path], pluginStub.settings.summaryWordsCount);
		expect(aggregated?.summary).toBe(expected);
	});

	it("creates multiple content entries when a line contains several dates", async () => {
		const ctime = Date.UTC(2025, 4, 10);
		const file = makeFile("folder/multi-dates.md", ctime);
		contents[file.path] = "Review 2025-01-05 outcomes and plan for 07/01/2025 plus revisit March 8, 2025";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		expect(contentDates.map(entry => entry.date)).toEqual([
			"2025-01-05",
			"2025-01-07",
			"2025-03-08"
		]);

		const jan5 = indexer.index["2025-01-05"]?.find(entry => entry.file === file.path);
		const jan7 = indexer.index["2025-01-07"]?.find(entry => entry.file === file.path);
		const mar8 = indexer.index["2025-03-08"]?.find(entry => entry.file === file.path);

		expect(jan5).toBeTruthy();
		expect(jan7).toBeTruthy();
		expect(mar8).toBeTruthy();

		// Content-date normal summaries should omit embedded dates (the date is already represented by the row).
		for (const e of [jan5, jan7, mar8]) {
			const s = String((e as any)?.summary ?? "");
			expect(s).not.toContain("2025-01-05");
			expect(s).not.toContain("07/01/2025");
			expect(s).not.toContain("March 8, 2025");
			// Still keep meaningful words.
			expect(s.toLowerCase()).toContain("review");
			expect(s.toLowerCase()).toContain("outcomes");
		}
	});

	it("expands content date ranges into per-day entries", async () => {
		const ctime = Date.UTC(2025, 4, 11);
		const file = makeFile("folder/range-content.md", ctime);
		contents[file.path] = "from 2025-01-01 to 2025-01-03";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		expect(contentDates.map(entry => entry.date)).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);

		expect(indexer.index["2025-01-01"]?.some(e => e.file === file.path)).toBe(true);
		expect(indexer.index["2025-01-02"]?.some(e => e.file === file.path)).toBe(true);
		expect(indexer.index["2025-01-03"]?.some(e => e.file === file.path)).toBe(true);
	});

	it("expands filename-derived date ranges into per-day entries", async () => {
		const ctime = Date.UTC(2025, 4, 12);
		const file = makeFile("folder/2025-01-01 - 2025-01-03.md", ctime);
		contents[file.path] = "Body";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.namedDate?.source).toBe("namedate");
		expect(fileData?.namedDate?.date).toBe("2025-01-01");
		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		const namedateDates = contentDates.filter(e => e.source === "namedate").map(e => e.date);
		expect(namedateDates).toEqual([
			"2025-01-02",
			"2025-01-03"
		]);

		expect(indexer.index["2025-01-01"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
		expect(indexer.index["2025-01-02"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
		expect(indexer.index["2025-01-03"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
	});

	it("expands filename-derived date ranges into per-day entries (empty file)", async () => {
		const ctime = Date.UTC(2025, 4, 13);
		const file = makeFile("folder/2025-01-01 - 2025-01-03.md", ctime);
		contents[file.path] = "";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.namedDate?.source).toBe("namedate");
		expect(fileData?.namedDate?.date).toBe("2025-01-01");
		const contentDates: FileDateEntry[] = fileData?.contentDates ?? [];
		const namedateDates = contentDates.filter(e => e.source === "namedate").map(e => e.date);
		expect(namedateDates).toEqual([
			"2025-01-02",
			"2025-01-03"
		]);

		expect(indexer.index["2025-01-01"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
		expect(indexer.index["2025-01-02"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
		expect(indexer.index["2025-01-03"]?.some(e => e.file === file.path && e.source === "namedate")).toBe(true);
	});

	it("does not prefix tracked summaries with filename in stored text", () => {
		const entry: FileDateEntry = {
			date: "2025-02-01",
			file: "folder/change.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "tracked",
			hidden: false
		};
		const text = "Updated header section";
		const combined = resolveSummaryForEntry(pluginStub, entry, text);
		expect(combined).toBe(text);
	});

	it("does not prefix parsed date summaries with filename in stored text", () => {
		const entry: FileDateEntry = {
			date: "2025-02-02",
			file: "folder/note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "content",
			hidden: false
		};
		const text = "Morning meeting notes";
		const combined = resolveSummaryForEntry(pluginStub, entry, text);
		expect(combined).toBe(text);
	});

	it("prefers highlighted markdown text for normal summaries", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro ==Important point== and **bold** plus *italic*";
		expect(makeSummary(input, pluginStub.settings.summaryWordsCount)).toBe("Important point and bold plus italic");
	});

	it("prefers first H1 heading over earlier H2/H3 headings", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input =
			"## Secondary heading\n" +
			"details\n\n" +
			"### Tertiary heading\n" +
			"more\n\n" +
			"# Primary heading\n" +
			"content";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Primary heading")).toBe(true);
		expect(out.includes("Secondary heading")).toBe(false);
	});

	it("prefers first H2 heading over H3 when no H1 exists", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input =
			"### Tertiary heading\n" +
			"details\n\n" +
			"## Secondary heading\n" +
			"content";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Secondary heading")).toBe(true);
		expect(out.includes("Tertiary heading")).toBe(false);
	});

	it("prefers blockquote text over attribution lines (including list-nested blockquotes)", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "- > Goodhart's law: when a measure becomes a target, it ceases to be a good measure.\n\n— Attribution";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Goodhart's law")).toBe(true);
		expect(out.includes("Attribution")).toBe(false);
	});

	it("does not treat embeds/links as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input =
			"Intro text\n\n![[20250717_200903.jpg]]\n\n- one\n- two\n- **stars** choose constellation turtle pen pattern above";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("stars")).toBe(true);
		expect(out.includes("200903.jpg")).toBe(false);
	});

	it("does not treat raw URL markers as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input =
			"Intro https://by.ebay.com/b/Wristwatches/31387/bn_2408451?campaign=ddd_dd&id=lll_kkk==FAKE== then **Real start** and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
		expect(out.includes("FAKE")).toBe(false);
	});

	it("does not treat underscore-wrapped snake_case as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro _foo_bar_ then **Real start** and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
		expect(out.includes("foo_bar")).toBe(false);
	});

	it("does not treat key=value underscore-wrapping as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro id=_abc_ then **Real start** and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
		expect(out.includes("abc")).toBe(false);
	});

	it("does not treat inline-code underscores as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro `__init__` and `_id_` then **Real start** and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
	});

	it("does not treat mid-word asterisk sequences as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro foo*bar*baz then ==Real start== and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
		expect(out.includes("bar")).toBe(false);
	});

	it("does not treat plain dunder-ish tokens as formatted summary starts", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input = "Intro __init__ then ==Real start== and more";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("Real start")).toBe(true);
		expect(out.includes("init")).toBe(false);
	});

	it("prefers YAML frontmatter description over formatted markers", () => {
		pluginStub.settings.summaryWordsCount = 10;
		const input =
			"---\n" +
			"description: YAML description wins\n" +
			"---\n\n" +
			"Intro ==Highlighted should not win== and **bold**";
		const out = makeSummary(input, pluginStub.settings.summaryWordsCount);
		expect(out.startsWith("YAML description wins")).toBe(true);
		expect(out.includes("Highlighted")).toBe(false);
	});

	it("uses YAML description over AI summary when present", async () => {
		pluginStub.settings.summaryWordsCount = 3;
		pluginStub.app.metadataCache = {
			getFileCache: vi.fn(() => ({
				frontmatter: { description: "YAML description wins" },
				tags: []
			}))
		};
		const ctime = Date.UTC(2025, 0, 5);
		const file = makeFile("folder/manual.md", ctime);
		contents[file.path] = [
			"---",
			"description: YAML description wins",
			"---",
			"First second third fourth"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const entry = indexer.index[dateKey]?.find(e => e.file === file.path);
		expect(entry?.summary).toBe("YAML description wins");

		(indexer as any).files[file.path].cdate.aiSummary = "AI SHOULD NOT WIN";
		(indexer as any).files[file.path].cdate.aiSummaryInputHash = "hash";
		(indexer as any).updateAggregatedEntries(file.path);
		const afterAi = indexer.index[dateKey]?.find(e => e.file === file.path);
		expect(afterAi?.summary).toBe("YAML description wins");
	});

	it("clears AI summary and falls back to normal summary", async () => {
		pluginStub.settings.summaryWordsCount = 3;
		const ctime = Date.UTC(2025, 0, 6);
		const file = makeFile("folder/ai.md", ctime);
		contents[file.path] = "First second third fourth";

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const fullText = contents[file.path];
		const aiText = "HELLO AI SUMMARY";
		const aiHash = computeAiSummaryInputHash(file.path, "anchor", fullText, 24000);

		const fileData: any = (indexer as any).files[file.path];
		fileData.cdate.aiSummary = aiText;
		fileData.cdate.aiSummaryInputHash = aiHash;
		fileData.cdate.aiSummaryVisible = true;
		(indexer as any).updateAggregatedEntries(file.path);

		const withAi = indexer.index[dateKey]?.find(entry => entry.file === file.path);
		expect(withAi?.summary).toBe(makeSummary(aiText, pluginStub.settings.summaryWordsCount));

		const cleared = (indexer as any).clearEntryAiSummary(withAi as any);
		expect(cleared).toBe(true);

		const afterClear = indexer.index[dateKey]?.find(entry => entry.file === file.path);
		expect(afterClear?.summary).toBe(makeSummary(fullText, pluginStub.settings.summaryWordsCount));
	});

	it("preserves visible AI summaries through rename reaggregation", async () => {
		pluginStub.settings.summaryWordsCount = 3;
		const ctime = Date.UTC(2025, 0, 7);
		const file = makeFile("folder/rename-ai.md", ctime);
		contents[file.path] = "First second third fourth";

		await indexer.processFile(file, { reason: "modify" });

		const oldPath = file.path;
		const newPath = "folder/renamed-ai.md";
		const renamedFile = makeFile(newPath, ctime);
		contents[newPath] = contents[oldPath];
		(pluginStub.app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => {
			if (path === newPath) return renamedFile;
			return null;
		});

		const fileData: any = (indexer as any).files[oldPath];
		const aiText = "AI SUMMARY WINS";
		const oldHash = computeAiSummaryInputHash(oldPath, "anchor", contents[oldPath], 24000);
		fileData.cdate.aiSummary = aiText;
		fileData.cdate.aiSummaryInputHash = oldHash;
		fileData.cdate.aiSummaryVisible = true;
		(indexer as any).updateAggregatedEntries(oldPath);

		await indexer.renameFile(oldPath, newPath);

		const dateKey = normalizeDateFromTimestamp(ctime);
		const renamed = indexer.index[dateKey]?.find(entry => entry.file === newPath);
		expect(renamed?.summary).toBe(makeSummary(aiText, pluginStub.settings.summaryWordsCount));
		expect((renamed as any)?.aiSummary).toBe(aiText);
		expect((renamed as any)?.aiSummaryInputHash).toBe(oldHash);
	});

	it("preserves dateProp AI summary when frontmatter date changes (drag-drop modify) with Auto summarize on", async () => {
		pluginStub.settings.summaryWordsCount = 3;
		pluginStub.settings.summarizeAI = true;
		const ctime = Date.UTC(2025, 0, 8);
		const file = makeFile("folder/drag-ai.md", ctime);
		const bodyText = "Alpha beta gamma delta";
		contents[file.path] = ["---", "date: 2025-01-10", "---", bodyText].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const oldDateKey = "2025-01-10";
		const fileData: any = (indexer as any).files[file.path];
		const aiText = "AI DND SUMMARY";
		const aiHash = computeAiSummaryInputHash(file.path, "anchor", contents[file.path], 24000);
		fileData.dateProp.aiSummary = aiText;
		fileData.dateProp.aiSummaryInputHash = aiHash;
		fileData.dateProp.aiSummaryVisible = true;
		(indexer as any).updateAggregatedEntries(file.path);

		const before = indexer.index[oldDateKey]?.find(e => e.file === file.path);
		expect(before?.summary).toBe(makeSummary(aiText, pluginStub.settings.summaryWordsCount));

		// Simulate setYamlDateForPath writing a new frontmatter date (drag target)
		const newDateKey = "2025-01-15";
		contents[file.path] = ["---", "date: 2025-01-15", "---", bodyText].join("\n");
		await indexer.processFile(file, { reason: "modify" });

		const after = indexer.index[newDateKey]?.find(e => e.file === file.path);
		expect(after).toBeDefined();
		expect(after?.summary).toBe(makeSummary(aiText, pluginStub.settings.summaryWordsCount));
	});
});
