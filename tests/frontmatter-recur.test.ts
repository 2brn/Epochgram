import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../src/indexer/indexer";
import { expandRecurrenceToDateKeys, parseWeekdayList } from "../src/indexer/recurrence";
import { createEmptyFileIndex } from "../src/indexer/file-index-factory";

describe("Frontmatter repeat", () => {
	let indexer: Indexer, plugin: any, content: string;
	beforeEach(() => {
		content = "";
		plugin = { settings: { summaryWordsCount: 8, parseDatesInFrontmatter: true }, app: { vault: { read: vi.fn(async () => content), getAbstractFileByPath: vi.fn() }, metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] })) }, workspace: { getActiveViewOfType: vi.fn() } } };
		indexer = new Indexer(plugin);
	});
	const file = (path = "folder/repeat.md", ctime = Date.UTC(2026, 2, 1)) => new (TFile as any)(path, { basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md", stat: { ctime, mtime: ctime, size: 0 } });
	const dates = () => Object.keys(indexer.index).filter(key => indexer.index[key].some(entry => entry.recurring)).sort();
	it.each(["repeat", "recur"])("expands %s for all users", async key => {
		content = `---\ndate: 2026-03-01\n${key}: every day until 2026-03-03\n---\nBody`;
		await indexer.processFile(file(), { reason: "modify" });
		expect(dates()).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
		for (const key of dates()) expect(indexer.index[key].find(entry => entry.recurring)).toMatchObject({ source: "content", fromFrontmatter: true });
	});
	it.each([
		["folder/2026-02-10 named.md", "date: 2026-03-01\n", "2026-02-10"],
		["folder/namedless.md", "date: 2026-03-01\n", "2026-03-01"],
		["folder/cdate.md", "", "2026-02-15"]
	])("uses filename, YAML, then cdate as recurrence start: %s", async (path, dateLine, expected) => {
		content = `---\n${dateLine}repeat: every day count 1\n---\nBody`;
		await indexer.processFile(file(path, Date.UTC(2026, 1, 15)), { reason: "modify" });
		expect(indexer.getFileIndexData(path)?.recur?.from).toBe(expected);
		expect(dates()).toEqual([expected]);
	});
	it.each([
		["every week on mon,wed,fri from 2026-03-01 count 3", ["2026-03-02", "2026-03-04", "2026-03-06"]],
		["FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=3", ["2026-03-02", "2026-03-04", "2026-03-06"]],
		["every 2 weeks on mon from 2026-03-01 count 3", ["2026-03-02", "2026-03-16", "2026-03-30"]],
		["every month on 1 from 2026-03-01 until 2026-04-15", ["2026-03-01", "2026-04-01"]],
		["every month on -1 from 2026-01-01 count 3", ["2026-01-31", "2026-02-28", "2026-03-31"]],
		["every month on -2 from 2026-01-01 count 3", ["2026-01-30", "2026-02-27", "2026-03-30"]]
	])("expands rule %s", async (rule, expected) => {
		content = `---\ndate: 2026-03-01\nrepeat: ${rule}\n---\nBody`;
		await indexer.processFile(file(), { reason: "modify" });
		expect(dates()).toEqual(expected);
	});
	it("uses an anchor fallback, never today when no start exists", () => {
		const recur = { raw: "every day", line: 0, rrule: "FREQ=DAILY;COUNT=2", kind: "rrule" as const };
		expect(expandRecurrenceToDateKeys({ recur, fallbackFromKey: "2026-04-10", todayKey: "2026-04-27" })).toEqual(["2026-04-10", "2026-04-11"]);
		expect(expandRecurrenceToDateKeys({ recur, todayKey: "2026-04-27" })).toEqual([]);
	});
	it("rehydrates recurring entries and stored summaries after load", async () => {
		const path = "folder/repeat.md";
		await indexer.load({ files: { [path]: { ...createEmptyFileIndex(), cdate: { file: path, date: "2026-03-01", blockStart: 0, blockEnd: 0, source: "cdate", summary: "Pay bills" }, recur: { raw: "every day from 2026-03-01 count 3", line: 1, from: "2026-03-01", count: 3, rrule: "FREQ=DAILY;COUNT=3", kind: "friendly" } } }, dates: {} });
		expect(dates()).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
		expect(indexer.index["2026-03-02"].find(entry => entry.recurring)?.summary).toBe("Pay bills");
		indexer.refreshSyntheticEntries(); expect(dates()).toHaveLength(3);
	});
	it("keeps anchor and recurring rows and applies manual descriptions to both", async () => {
		content = "---\ndate: 2026-03-01\nrepeat: every day until 2026-03-03\ndescription: Manual summary\n---\nBody";
		plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { description: "Manual summary" } });
		await indexer.processFile(file(), { reason: "modify" });
		expect(indexer.index["2026-03-01"].find(entry => entry.source === "dateprop")?.summary).toBe("Manual summary");
		expect(indexer.index["2026-03-02"].find(entry => entry.recurring)?.summary).toBe("Manual summary");
	});
	it("parses full weekday names and abbreviations", () => {
		expect(parseWeekdayList("Monday, Tues, Wednesday, Thur, Friday, Sat, Sunday")).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
	});
});
