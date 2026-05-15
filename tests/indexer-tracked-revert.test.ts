import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const diffLinesMock = vi.hoisted(() => vi.fn());
vi.mock("diff", async () => {
	const actual = await vi.importActual<typeof import("diff")>("diff");
	(diffLinesMock as Mock).mockImplementation((...args: Parameters<typeof actual.diffLines>) =>
		actual.diffLines(...args)
	);
	return {
		...actual,
		diffLines: diffLinesMock
	};
});
import type { Change } from "diff";
import { Indexer } from "../src/indexer/indexer";
import type { EpochIndex, TrackedChangeType } from "../src/indexer/types";
import { TFile } from "obsidian";
import {
 SUMMARY_ENTRY_SEPARATOR,
 SUMMARY_ICON_TRACKED_ADDED,
} from "../src/ui/epoch-canvas-constants";
import { entryFileName, formatEntrySummary, selectTimelineEntries, shouldRenderEntry, summaryIconLabel } from "../src/ui/epoch-canvas-utils";

interface DayData {
	ts: number;
	date: string;
	summary: string;
}

const buildDayData = (index: EpochIndex): DayData[] => {
	const out: DayData[] = [];

	for (const date of Object.keys(index)) {
		const entries = index[date];
		if (!entries || entries.length === 0) continue;
		const filteredEntries = entries.filter(shouldRenderEntry);
		const visibleEntries = selectTimelineEntries(filteredEntries);
		if (visibleEntries.length === 0) continue;

		const [yyyy, mm, dd] = date.split("-");
		const ts = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));

		const summary = visibleEntries
			.map(entry => {
				const rendered =
					(formatEntrySummary(entry, {
						fallbackToFileName: true
					}) || "").trim();
				if (rendered) {
					return rendered;
				}
				return entryFileName(entry);
			})
			.filter(Boolean)
			.join(SUMMARY_ENTRY_SEPARATOR);

		out.push({
			ts,
			date,
			summary
		});
	}

	out.sort((a, b) => a.ts - b.ts);
	return out;
};

const TEST_DAY = "2025-11-28T09:00:00.000Z";

const makeFile = (path: string): TFile => {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		name,
		extension,
		basename,
		stat: { ctime: Date.now(), mtime: Date.now(), size: 0 }
	});
};

describe("tracked changes revert", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;
	const file = makeFile("folder/note.md");

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(TEST_DAY));
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 5
			},
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? "")
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

	const trackedEntriesForFile = (index: EpochIndex, path: string) => {
		return Object.values(index)
			.flat()
			.filter(entry => entry.file === path && entry.source === "tracked");
	};

	const trackedSummaries = (index: EpochIndex, path: string) =>
		trackedEntriesForFile(index, path)
			.map(entry => entry.summary)
			.filter((summary): summary is string => typeof summary === "string");

	const trackedChanges = (index: EpochIndex, path: string) =>
		trackedEntriesForFile(index, path)
			.map(entry => entry.trackedChange)
			.filter((value): value is TrackedChangeType => typeof value === "string");

	const trackedTimes = (index: EpochIndex, path: string) =>
		trackedEntriesForFile(index, path)
			.map(entry => entry.trackedTime)
			.filter((value): value is string => typeof value === "string");

	it("drops tracked diff after reverting added text", async () => {
		const original = "Line alpha\nLine bravo";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(0);

		contents[file.path] = `${original}\nNew line`;
		await indexer.processFile(file, { reason: "track" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(1);

		contents[file.path] = original;
		await indexer.processFile(file, { reason: "track" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(0);
	});

	it("shows addition summary when appending new line", async () => {
		const original = "row 1";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = `${original}\nrow 2`;
		await indexer.processFile(file, { reason: "track" });

		const entries = trackedEntriesForFile(indexer.index, file.path);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.summary).toBe("row 2");
		expect(entries[0]?.trackedChange).toBe("added");
	});

	it("ignores blank line only changes", async () => {
		const original = "Line alpha\nLine bravo";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(0);

		contents[file.path] = `${original}\n`;
		await indexer.processFile(file, { reason: "track" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(0);

		contents[file.path] = original;
		await indexer.processFile(file, { reason: "track" });
		expect(trackedEntriesForFile(indexer.index, file.path)).toHaveLength(0);
	});

	it("summarizes removal when date heading is deleted", async () => {
		const original = "30-11-2025\nmy new changes";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = "my new changes";
		await indexer.processFile(file, { reason: "track" });

		const summaries = trackedSummaries(indexer.index, file.path);
		expect(summaries).toEqual(["30-11-2025"]);
		const changes = trackedChanges(indexer.index, file.path);
		expect(changes).toEqual(["removed"]);
	});

	it("records modification and removal when heading shortened", async () => {
		const original = "30-11-2025\nmy new changes";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = "30-11-202";
		await indexer.processFile(file, { reason: "track" });

		const summaries = trackedSummaries(indexer.index, file.path);
		expect(new Set(summaries)).toEqual(
			new Set([
				"30-11-202",
				"my new changes"
			])
		);
		const changes = trackedChanges(indexer.index, file.path);
		expect(new Set(changes)).toEqual(new Set(["modified", "removed"]));
	});

	it("splits replacement with trailing additions", async () => {
		const original = "totally";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = "totally new\nrows";
		await indexer.processFile(file, { reason: "track" });

		const summaries = trackedSummaries(indexer.index, file.path);
		expect(new Set(summaries)).toEqual(
			new Set([
				"totally new",
				"rows"
			])
		);
		const changes = trackedChanges(indexer.index, file.path);
		expect(new Set(changes)).toEqual(new Set(["modified", "added"]));
	});

	it("surfaces the newest tracked change even when it appears higher in the file", async () => {
		const base = ["alpha", "bravo", "charlie", "delta", "echo"].join("\n");
		contents[file.path] = base;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = `${base}\nTAIL`;
		await indexer.processFile(file, { reason: "track" });

		contents[file.path] = ["alpha", "NEW TOP", "bravo", "charlie", "delta", "echo", "TAIL"].join("\n");
		await indexer.processFile(file, { reason: "track" });

		const entries = trackedEntriesForFile(indexer.index, file.path);
		expect(entries).toHaveLength(2);

		const times = trackedTimes(indexer.index, file.path).map(value => Date.parse(value));
		expect(times.some(time => Number.isNaN(time))).toBe(false);
		expect(Math.max(...times)).toBeGreaterThan(Math.min(...times));

		const dayKey = Object.keys(indexer.index).sort()[0];
		const dayEntries = indexer.index[dayKey];
		const timeline = selectTimelineEntries(dayEntries);
		const fileEntry = timeline.find(entry => entry.file === file.path);
		expect(fileEntry).toBeDefined();
		expect(fileEntry?.summary ?? "").toContain("NEW TOP");
	});

	it("merges consecutive tracked blocks that share the same change type", async () => {
		const original = "base";
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		const mockChanges: Change[] = [
			{ added: true, removed: false, value: "first\n" },
			{ added: true, removed: false, value: "second\n" }
		];
		(diffLinesMock as Mock).mockImplementationOnce(() => mockChanges as any);

		try {
			contents[file.path] = `${original}\nfirst\nsecond`;
			await indexer.processFile(file, { reason: "track" });
		} finally {
			// default mock delegates to actual diffLines; no explicit restore required
		}

		const entries = trackedEntriesForFile(indexer.index, file.path);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.trackedChange).toBe("added");
		expect(entries[0]?.summary ?? "").toContain("second");
	});

	it("updates tracked time whenever an existing block changes", async () => {
		const original = ["alpha", "bravo"].join("\n");
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });

		contents[file.path] = `${original}\ncharlie`;
		await indexer.processFile(file, { reason: "track" });

		let entries = trackedEntriesForFile(indexer.index, file.path);
		expect(entries).toHaveLength(1);
		const firstTime = entries[0]?.trackedTime;
		expect(firstTime).toBeDefined();

		vi.advanceTimersByTime(1000);
		contents[file.path] = `${original}\ncharlie updated`;
		await indexer.processFile(file, { reason: "track" });

		entries = trackedEntriesForFile(indexer.index, file.path);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.summary ?? "").toContain("charlie updated");
		expect(entries[0]?.trackedTime).toBeDefined();
		expect(entries[0]?.trackedTime).not.toBe(firstTime);
	});
});

describe("tracked summaries in day data", () => {
	const baseEntry = {
		file: "folder/note.md",
		blockStart: 0,
		blockEnd: 0,
		hidden: false,
		source: "tracked" as const
	};

	it("keeps tracked summary text without file fallback", () => {
		const index: EpochIndex = {
			"2025-11-28": [
				{
					date: "2025-11-28",
					summary: "2025-11-28.md",
					trackedChange: "added",
					...baseEntry
				}
			]
		};
		const days = buildDayData(index);
		expect(days).toHaveLength(1);
		expect(days[0]?.summary).toBe(`${summaryIconLabel(SUMMARY_ICON_TRACKED_ADDED)} note${SUMMARY_ENTRY_SEPARATOR}2025-11-28.md`);
	});

	it("does not fall back to filename when only marker remains", () => {
		const index: EpochIndex = {
			"2025-11-28": [
				{
					date: "2025-11-28",
					summary: "",
					trackedChange: "added",
					...baseEntry
				}
			]
		};
		const days = buildDayData(index);
		expect(days).toHaveLength(1);
		expect(days[0]?.summary).toBe(`${summaryIconLabel(SUMMARY_ICON_TRACKED_ADDED)} note`);
	});
});
