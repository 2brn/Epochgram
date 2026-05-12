import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";
import { expandRecurrenceToDateKeys } from "../src/indexer/recurrence";

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

function makeFileWithParent(path: string, ctime: number): TFile {
	const file = makeFile(path, ctime) as any;
	const parentPath = (() => {
		const idx = path.lastIndexOf("/");
		return idx >= 0 ? path.slice(0, idx) : "";
	})();
	file.parent = { path: parentPath };
	return file;
}

describe("Frontmatter repeat", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			hasProAccess: () => true,
			hasRecurringAccess: () => true,
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

	it("does not emit recurring entries without the recurring entitlement", async () => {
		pluginStub.hasRecurringAccess = () => false;
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-no-recurring-feature.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(false);
		}
	});

	it("emits recurring entries with the recurring entitlement even without track changes", async () => {
		pluginStub.hasProAccess = () => false;
		pluginStub.hasRecurringAccess = () => true;
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-recurring-only.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(true);
		}
	});

	it("defaults repeat start to filename date over YAML date", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("folder/2026-02-10 named.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day count 1",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day count 1" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData: any = (indexer as any).files[file.path];
		expect(fileData?.recur?.from).toBe("2026-02-10");
		const list: any[] = ((indexer as any).index["2026-02-10"] ?? []) as any[];
		expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(true);
	});

	it("defaults repeat start to YAML date when no filename date", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("folder/namedless.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day count 1",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day count 1" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData: any = (indexer as any).files[file.path];
		expect(fileData?.recur?.from).toBe("2026-03-01");
		const list: any[] = ((indexer as any).index["2026-03-01"] ?? []) as any[];
		expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(true);
	});

	it("defaults repeat start to cdate when no filename date or YAML date", async () => {
		const ctime = Date.UTC(2026, 1, 15);
		const file = makeFile("folder/cdate-only.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every day count 1",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every day count 1" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData: any = (indexer as any).files[file.path];
		expect(fileData?.recur?.from).toBe("2026-02-15");
		const list: any[] = ((indexer as any).index["2026-02-15"] ?? []) as any[];
		expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(true);
	});

	it("uses anchor fallback as from when explicit from is missing", () => {
		const keys = expandRecurrenceToDateKeys({
			recur: {
				raw: "every day",
				line: 0,
				rrule: "FREQ=DAILY;COUNT=2",
				kind: "rrule"
			} as any,
			fallbackFromKey: "2026-04-10",
			todayKey: "2026-04-27"
		});
		expect(keys).toEqual(["2026-04-10", "2026-04-11"]);
	});

	it("does not default recurrence expansion to today when from and anchor fallback are missing", () => {
		const keys = expandRecurrenceToDateKeys({
			recur: {
				raw: "every day",
				line: 0,
				rrule: "FREQ=DAILY",
				kind: "friendly"
			} as any,
			todayKey: "2026-04-27"
		});
		expect(keys).toEqual([]);
	});

	it("does not emit recurring entries without Pro", async () => {
		pluginStub.hasProAccess = () => false;
		pluginStub.hasRecurringAccess = () => false;
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-nopro.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(false);
		}
	});

	it("removes already-expanded recurring entries after Pro deactivation", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-deactivate.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(true);
		}

		pluginStub.hasProAccess = () => false;
		pluginStub.hasRecurringAccess = () => false;
		indexer.refreshSyntheticEntries();
		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e && e.file === file.path && e.recurring === true)).toBe(false);
		}
	});

	it("preserves hidden reviewState across index refresh", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFileWithParent("folder/hidden-refresh.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer as any).index["2026-03-01"] ?? []) as any[];
		const anchor = list.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchor).toBeTruthy();

		const ok = indexer.setEntryHidden(anchor, true);
		expect(ok).toBe(true);
		const listAfterHide: any[] = ((indexer as any).index["2026-03-01"] ?? []) as any[];
		const anchorAfterHide = listAfterHide.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchorAfterHide?.reviewState).toBe("hidden");

		await indexer.reprocessAll([file]);
		const listAfterRefresh: any[] = ((indexer as any).index["2026-03-01"] ?? []) as any[];
		const anchorAfterRefresh = listAfterRefresh.find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchorAfterRefresh?.reviewState).toBe("hidden");
	});

	it("can hide a synthetic recurring occurrence", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-hide.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });
		const list: any[] = ((indexer as any).index["2026-03-02"] ?? []) as any[];
		const recurring = list.find((e) => e && e.file === file.path && e.recurring === true);
		expect(recurring).toBeTruthy();
		expect(recurring?.reviewState).not.toBe("hidden");

		const ok = indexer.setEntryHidden(recurring, true);
		expect(ok).toBe(true);
		const listAfterHide: any[] = ((indexer as any).index["2026-03-02"] ?? []) as any[];
		const recurringAfterHide = listAfterHide.find((e) => e && e.file === file.path && e.recurring === true);
		expect(recurringAfterHide?.reviewState).toBe("hidden");

		indexer.refreshSyntheticEntries();
		const listAfterRefresh: any[] = ((indexer as any).index["2026-03-02"] ?? []) as any[];
		const recurringAfterRefresh = listAfterRefresh.find((e) => e && e.file === file.path && e.recurring === true);
		expect(recurringAfterRefresh?.reviewState).toBe("hidden");

		await indexer.reprocessAll([file]);
		const listAfterReprocess: any[] = ((indexer as any).index["2026-03-02"] ?? []) as any[];
		const recurringAfterReprocess = listAfterReprocess.find((e) => e && e.file === file.path && e.recurring === true);
		expect(recurringAfterReprocess?.reviewState).toBe("hidden");
	});

	it("expands a friendly rule (daily until) into per-day recurring entries", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true)).toBe(true);
		}
	});

	it("accepts `recur` as an alias for `repeat`", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/recur.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"recur: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", recur: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		for (const k of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
			const list: any[] = ((indexer as any).index[k] ?? []) as any[];
			expect(list.some((e) => e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true)).toBe(true);
		}
	});

	it("expands a weekday list with count", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/recur2.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every week on mon,wed,fri from 2026-03-01 count 3",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every week on mon,wed,fri from 2026-03-01 count 3" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const expected = ["2026-03-02", "2026-03-04", "2026-03-06"]; // Mon/Wed/Fri after 2026-03-01 (Sun)
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("accepts raw RRULE strings", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/recur3.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=3",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=3" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const expected = ["2026-03-02", "2026-03-04", "2026-03-06"]; // Mon/Wed/Fri after 2026-03-01 (Sun)
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("expands every N weeks on weekday list", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/recur4.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every 2 weeks on mon from 2026-03-01 count 3",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every 2 weeks on mon from 2026-03-01 count 3" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const expected = ["2026-03-02", "2026-03-16", "2026-03-30"]; // Every 2 weeks on Monday
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("expands every month on day until", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/recur5.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every month on 1 from 2026-03-01 until 2026-04-15",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every month on 1 from 2026-03-01 until 2026-04-15" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const expected = ["2026-03-01", "2026-04-01"]; // 2026-05-01 is beyond until
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("expands every month on -1 (last day) with count", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("folder/recur-month-last-day.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every month on -1 from 2026-01-01 count 3",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every month on -1 from 2026-01-01 count 3" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.recur?.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");

		const expected = ["2026-01-31", "2026-02-28", "2026-03-31"];
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("expands every month on -2 (second-to-last day) with count", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("folder/recur-month-second-last-day.md", ctime);

		contents[file.path] = [
			"---",
			"repeat: every month on -2 from 2026-01-01 count 3",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { repeat: "every month on -2 from 2026-01-01 count 3" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		expect(fileData?.recur?.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=-2");

		const expected = ["2026-01-30", "2026-02-27", "2026-03-30"];
		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const got = Object.keys(idx)
			.filter((k) => (idx[k] ?? []).some((e) => e && e.file === file.path && e.source === "content" && e.fromFrontmatter === true && e.recurring === true))
			.sort();
		expect(got).toEqual(expected);
	});

	it("rehydrates recurring entries after disk load", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0, 0));
		try {
			const serialized: any = {
				files: {
					"folder/recur-load.md": {
						cdate: null,
						namedDate: null,
						dateProp: null,
						contentDates: [],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null,
						recur: {
							raw: "every day from 2026-03-01 count 3",
							line: 1,
							from: "2026-03-01",
							count: 3,
							rrule: "FREQ=DAILY;COUNT=3",
							kind: "friendly"
						}
					}
				},
				dates: {}
			};

			await indexer.load(serialized);

			const idx: Record<string, any[]> = (indexer as any).index ?? {};
			const got = Object.keys(idx)
				.filter((k) => (idx[k] ?? []).some((e) => e && e.file === "folder/recur-load.md" && e.recurring === true))
				.sort();
			expect(got).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses stored anchor summary for recurring entries when description cache is unavailable on reload", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 17, 12, 0, 0, 0));
		try {
			// Simulate a reload where metadata cache doesn't yet have frontmatter `description`.
			(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({ frontmatter: {}, tags: [] }));
			const serialized: any = {
				files: {
					"folder/recur-summary-load.md": {
						cdate: {
							date: "2026-03-01",
							file: "folder/recur-summary-load.md",
							blockStart: 0,
							blockEnd: 0,
							summary: "ОПЛАТИТИ КОМУНАЛЬНІ",
							source: "cdate"
						},
						namedDate: null,
						dateProp: null,
						contentDates: [],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null,
						recur: {
							raw: "every month on 1 from 2026-03-01 count 1",
							line: 2,
							from: "2026-03-01",
							count: 1,
							rrule: "FREQ=MONTHLY;BYMONTHDAY=1;COUNT=1",
							kind: "friendly"
						}
					}
				},
				dates: {}
			};

			await indexer.load(serialized);

			const idx: Record<string, any[]> = (indexer as any).index ?? {};
			const recurring = (idx["2026-03-01"] ?? []).find((e) => e && e.file === "folder/recur-summary-load.md" && e.recurring === true);
			expect(recurring).toBeTruthy();
			expect(String(recurring.summary ?? "").trim()).toBe("ОПЛАТИТИ КОМУНАЛЬНІ");
		} finally {
			vi.useRealTimers();
		}
	});

	it("editing a recurring summary applies to the anchor row summary", async () => {
		const ctime = Date.UTC(2026, 2, 1);
		const file = makeFile("folder/repeat-edit-summary.md", ctime);

		contents[file.path] = [
			"---",
			"date: 2026-03-01",
			"repeat: every day until 2026-03-03",
			"---",
			"Body"
		].join("\n");

		(pluginStub.app.metadataCache.getFileCache as any).mockImplementation(() => ({
			frontmatter: { date: "2026-03-01", repeat: "every day until 2026-03-03" },
			tags: []
		}));

		await indexer.processFile(file, { reason: "modify" });

		const idx: Record<string, any[]> = (indexer as any).index ?? {};
		const anchor = (idx["2026-03-01"] ?? []).find((e) => e && e.file === file.path && e.source === "dateprop");
		expect(anchor).toBeTruthy();

		const recurringBefore = (idx["2026-03-02"] ?? []).find((e) => e && e.file === file.path && e.recurring === true);
		expect(recurringBefore).toBeTruthy();
	});
});
