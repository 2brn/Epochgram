import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { TFile } from "obsidian";
import { computeAiSummaryInputHash } from "../src/utils";
import { extractText } from "../src/indexer/summary-helpers";
import type { FileDateEntry } from "../src/indexer/types";

describe("AI summary grouping (date × type)", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 8,
				summarizeAI: true
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

	it("uses one AI summary for all content entries of same date", async () => {
		const ctime = Date.UTC(2025, 11, 27);
		const file = makeFile("folder/grouped.md", ctime);
		contents[file.path] = [
			"2025-12-27 First block",
			"2025-12-28 Other day",
			"2025-12-27 Second block"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const lines = contents[file.path].split(/\r?\n/);
		(indexer as any).latestLines[file.path] = lines;

		const contentEntries: FileDateEntry[] = (fileData?.contentDates ?? []).filter((e: any) => e.date === "2025-12-27");
		expect(contentEntries.length).toBeGreaterThanOrEqual(2);

		const groupInput = contentEntries
			.map(e => extractText(lines, e.blockStart, e.blockEnd))
			.filter(Boolean)
			.join("\n\n");
		const groupHash = computeAiSummaryInputHash(file.path, "2025-12-27|content", groupInput, 24000);

		for (const e of contentEntries) {
			e.aiSummary = "GROUP AI";
			e.aiSummaryInputHash = groupHash;
		}

		(indexer as any).updateAggregatedEntries(file.path);

		const entriesOnDate = indexer.index["2025-12-27"]?.filter((e: any) => e.file === file.path && e.source === "content") ?? [];
		expect(entriesOnDate.length).toBeGreaterThanOrEqual(2);
		for (const e of entriesOnDate) {
			expect(e.summary).toBe("GROUP AI");
		}
	});

	it("uses one AI summary for all tracked entries of same date", async () => {
		const ctime = Date.UTC(2025, 11, 27);
		const file = makeFile("folder/tracked.md", ctime);
		contents[file.path] = "2025-12-27 Seed";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const dateKey = normalizeDateFromTimestamp(ctime);
		const trackedEntries: FileDateEntry[] = [
			{
				date: dateKey,
				file: file.path,
				blockStart: 0,
				blockEnd: 0,
				summary: "Changed header",
				source: "tracked",
				hidden: false
			},
			{
				date: dateKey,
				file: file.path,
				blockStart: 1,
				blockEnd: 1,
				summary: "Updated section",
				source: "tracked",
				hidden: false
			}
		];
		fileData.trackedDates = fileData.trackedDates ?? {};
		fileData.trackedDates[dateKey] = trackedEntries;

		const groupInput = trackedEntries.map(e => String(e.summary ?? "").trim()).filter(Boolean).join("\n");
		const groupHash = computeAiSummaryInputHash(file.path, `${dateKey}|tracked`, groupInput, 24000);
		for (const e of trackedEntries) {
			e.aiSummary = "TRACKED AI";
			e.aiSummaryInputHash = groupHash;
		}

		(indexer as any).latestLines[file.path] = contents[file.path].split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const entriesOnDate = indexer.index[dateKey]?.filter((e: any) => e.file === file.path && e.source === "tracked") ?? [];
		expect(entriesOnDate.length).toBeGreaterThanOrEqual(2);
		for (const e of entriesOnDate) {
			expect(e.summary).toBe("TRACKED AI");
		}
	});

	it("keeps tracked AI summary even if group hash becomes stale", async () => {
		const ctime = Date.UTC(2025, 11, 27);
		const file = makeFile("folder/tracked-stale.md", ctime);
		contents[file.path] = "2025-12-27 Seed";

		await indexer.processFile(file, { reason: "modify" });

		const fileData = (indexer as any).files[file.path];
		const dateKey = normalizeDateFromTimestamp(ctime);
		const trackedEntries: FileDateEntry[] = [
			{
				date: dateKey,
				file: file.path,
				blockStart: 0,
				blockEnd: 0,
				summary: "Changed header",
				source: "tracked",
				hidden: false
			},
			{
				date: dateKey,
				file: file.path,
				blockStart: 1,
				blockEnd: 1,
				summary: "Updated section",
				source: "tracked",
				hidden: false
			}
		];
		fileData.trackedDates = fileData.trackedDates ?? {};
		fileData.trackedDates[dateKey] = trackedEntries;

		for (const e of trackedEntries) {
			e.aiSummary = "TRACKED AI";
			e.aiSummaryInputHash = "definitely-not-the-real-hash";
		}

		(indexer as any).latestLines[file.path] = contents[file.path].split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const entriesOnDate = indexer.index[dateKey]?.filter((e: any) => e.file === file.path && e.source === "tracked") ?? [];
		expect(entriesOnDate.length).toBeGreaterThanOrEqual(2);
		for (const e of entriesOnDate) {
			expect(e.summary).toBe("TRACKED AI");
		}
	});
});
