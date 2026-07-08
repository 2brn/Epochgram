import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

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

describe("ReviewState reset on edit", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-12T09:00:00.000Z"));
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 5
			},
			hasProAccess: () => false,
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

	afterEach(() => {
		vi.useRealTimers();
	});

	it("editing a pinned Reviewed file keeps it Reviewed", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/pinned.md", ctime);

		contents[file.path] = "Initial";
		await indexer.processFile(file, { reason: "modify" });

		// simulate user pin + reviewed
		const data: any = (indexer as any).files[file.path];
		data.pinnedFile = true;
		if (data.cdate) (data.cdate as any).reviewState = "reviewed";
		(indexer as any).updateAggregatedEntries(file.path);

		// edit again
		contents[file.path] = "Initial\nChanged";
		await indexer.processFile(file, { reason: "modify" });

		const data2: any = (indexer as any).files[file.path];
		expect((data2.cdate as any)?.reviewState).toBe("reviewed");

		// sanity: aggregated entries stay reviewed
		const cdateKey = "2025-01-01";
		const anchor = indexer.index[cdateKey]?.find(e => e.file === file.path);
		expect(anchor?.reviewState).toBe("reviewed");

		// pinned-today entry also stays reviewed
		const todayKey = "2026-01-12";
		const pinnedToday = indexer.index[todayKey]?.find(e => e.file === file.path);
		expect(pinnedToday?.pinned).toBe(true);
		expect(pinnedToday?.reviewState).toBe("reviewed");
	});

	it("editing a non-pinned Reviewed file resets it to Draft", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/regular.md", ctime);

		contents[file.path] = "Initial";
		await indexer.processFile(file, { reason: "modify" });

		const data: any = (indexer as any).files[file.path];
		expect(data).toBeTruthy();
		if (data.cdate) (data.cdate as any).reviewState = "reviewed";
		(indexer as any).updateAggregatedEntries(file.path);

		contents[file.path] = "Initial\nChanged";
		await indexer.processFile(file, { reason: "modify" });

		const data2: any = (indexer as any).files[file.path];
		expect(String((data2.cdate as any)?.reviewState ?? "draft")).toBe("draft");

		const cdateKey = "2025-01-01";
		const anchor = indexer.index[cdateKey]?.find(e => e.file === file.path);
		expect(String(anchor?.reviewState ?? "draft")).toBe("draft");
	});

	it("editing a reviewed tracked-change record resets it to Draft", async () => {
		pluginStub.settings.trackChanges = true;
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/tracked.md", ctime);

		contents[file.path] = "Initial";
		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = "Initial\nChanged";
		await indexer.processFile(file, { reason: "modify" });

		const data: any = (indexer as any).files[file.path];
		const trackedDay = Object.keys(data.trackedDates ?? {})[0] ?? "2026-01-12";
		const trackedEntry = (data.trackedDates?.[trackedDay] ?? [])[0];
		expect(trackedEntry).toBeTruthy();
		(trackedEntry as any).reviewState = "reviewed";
		data.trackedDates["2026-01-11"] = [
			{
				...trackedEntry,
				date: "2026-01-11",
				summary: "Older tracked change",
				trackedHash: "older-hash",
				trackedTime: "2026-01-11T09:00:00.000Z",
				reviewState: "reviewed"
			}
		];
		(indexer as any).updateAggregatedEntries(file.path);

		contents[file.path] = "Initial\nChanged again";
		await indexer.processFile(file, { reason: "modify" });

		const data2: any = (indexer as any).files[file.path];
		const trackedEntriesAfter = Object.values(data2.trackedDates ?? {}).flat() as any[];
		expect(trackedEntriesAfter.length).toBeGreaterThan(0);
		expect(
			trackedEntriesAfter.some((entry) => entry.date === trackedDay && entry.reviewState === "reviewed")
		).toBe(false);
		expect(
			trackedEntriesAfter.find((entry) => entry.date === "2026-01-11")?.reviewState
		).toBe("reviewed");

		const trackedVisible = (indexer.index[trackedDay] ?? []).find((e) => e.file === file.path && e.source === "tracked");
		expect(trackedVisible?.reviewState).toBe("draft");
	});

	it("a no-op modify (same content) does not reset Reviewed to Draft", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/sync-touch.md", ctime);

		contents[file.path] = "Line1\nLine2";
		await indexer.processFile(file, { reason: "modify" });

		const data: any = (indexer as any).files[file.path];
		if (data.cdate) (data.cdate as any).reviewState = "reviewed";
		(indexer as any).updateAggregatedEntries(file.path);

		// Simulate Sync touching the file without any content changes (including CRLF normalization)
		contents[file.path] = "Line1\r\nLine2";
		await indexer.processFile(file, { reason: "modify" });

		const data2: any = (indexer as any).files[file.path];
		expect(String((data2.cdate as any)?.reviewState ?? "")).toBe("reviewed");
	});
});
