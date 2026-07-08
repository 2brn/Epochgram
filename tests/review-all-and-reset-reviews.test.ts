import { describe, it, expect, vi } from "vitest";
import { reviewAllDraftFiles, resetAllReviewStates } from "../src/plugin/maintenance/reset-helpers";
import { Indexer } from "../src/indexer/indexer";
import { setFileReviewStateForAllRecordsPreserveHidden } from "../src/indexer/entry-updates";
import { TFile } from "obsidian";

function makePluginWithIndexer(indexer: any) {
	return { indexer } as any;
}

describe("Review all + Reset reviews", () => {
	it("Review all marks all records Reviewed (bulk per-file)", () => {
		const files: any = {
			"a.md": {},
			"b.md": {},
			"c.md": {}
		};
		const setFileReviewStateForAllRecordsPreserveHidden = vi.fn((p: string, next: any) => {
			if (!files[p]) return false;
			// Simulate: only a.md actually changed.
			return p === "a.md" && next === "reviewed";
		});
		const refreshSyntheticEntries = vi.fn();
		const indexer: any = {
			files,
			getIndexedPaths: () => Object.keys(files),
			refreshSyntheticEntries,
			setFileReviewStateForAllRecordsPreserveHidden
		};

		const changed = reviewAllDraftFiles(makePluginWithIndexer(indexer));
		expect(changed).toBe(1);
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledTimes(3);
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledWith("a.md", "reviewed");
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledWith("b.md", "reviewed");
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledWith("c.md", "reviewed");
		expect(refreshSyntheticEntries).toHaveBeenCalledTimes(1);
	});

	it("Review all also updates index-only records when file-backed changes exist", () => {
		const index: any = {
			"2026-01-01": [
				{ file: "a.md", source: "content", reviewState: "draft" },
				{ file: "orphan.md", source: "content", reviewState: "draft" }
			]
		};
		const files: any = {
			"a.md": {}
		};
		const setFileReviewStateForAllRecordsPreserveHidden = vi.fn((p: string, next: any) => {
			if (!files[p]) return false;
			return p === "a.md" && next === "reviewed";
		});
		const indexer: any = {
			files,
			index,
			getIndexedPaths: () => Object.keys(files),
			setFileReviewStateForAllRecordsPreserveHidden
		};

		const changed = reviewAllDraftFiles(makePluginWithIndexer(indexer));
		expect(changed).toBe(2);
		expect(index["2026-01-01"][1].reviewState).toBe("reviewed");
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledWith("a.md", "reviewed");
		expect(setFileReviewStateForAllRecordsPreserveHidden).toHaveBeenCalledWith("orphan.md", "reviewed");
	});

	it("Review all recurring can mark reviewed on first run without prebuilt synthetic recurring index entries", () => {
		const filePath = "recur.md";
		const files: any = {
			[filePath]: {
				cdate: {
					date: "2026-03-01",
					file: filePath,
					source: "cdate",
					blockStart: 0,
					blockEnd: 0,
					summary: ""
				},
				namedDate: null,
				dateProp: null,
				contentDates: [],
				trackedDates: {},
				recur: {
					raw: "every day count 3",
					rrule: "FREQ=DAILY",
					kind: "friendly",
					line: 0,
					from: "2026-03-01",
					count: 3
				},
				recurHiddenDates: [],
				recurReviewedDates: []
			}
		};
		const indexer: any = {
			files,
			index: {},
			plugin: {},
			updateAggregatedEntries: vi.fn()
		};

		const changed = setFileReviewStateForAllRecordsPreserveHidden(indexer, filePath, "reviewed");
		expect(changed).toBe(true);
		expect(new Set(files[filePath].recurReviewedDates ?? [])).toEqual(new Set(["2026-03-01", "2026-03-02", "2026-03-03"]));
		expect(indexer.updateAggregatedEntries).toHaveBeenCalledWith(filePath);
	});

	it("Review all rehydrates file reviewState from reviewed date buckets", () => {
		const index: any = {
			"2026-07-07": [
				{
					file: "todo.md",
					source: "content",
					date: "2026-07-07",
					blockStart: 12,
					blockEnd: 12,
					reviewState: "reviewed"
				}
			]
		};
		const files: any = {
			"todo.md": {
				cdate: null,
				namedDate: null,
				dateProp: null,
				contentDates: [
					{
						file: "todo.md",
						source: "content",
						date: "2026-07-07",
						blockStart: 12,
						blockEnd: 12
					}
				],
				trackedDates: {}
			}
		};
		const updateAggregatedEntries = vi.fn();
		const setFileReviewStateForAllRecordsPreserveHidden = vi.fn(() => false);
		const indexer: any = {
			files,
			index,
			getIndexedPaths: () => ["todo.md"],
			setFileReviewStateForAllRecordsPreserveHidden,
			updateAggregatedEntries
		};

		const changed = reviewAllDraftFiles(makePluginWithIndexer(indexer));
		expect(changed).toBe(1);
		expect(files["todo.md"].contentDates[0].reviewState).toBe("reviewed");
		expect(updateAggregatedEntries).toHaveBeenCalledWith("todo.md");
	});

	it("Review all does not unhide hidden records", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-11-28T09:00:00.000Z"));

		const contents: Record<string, string> = {};
		const pluginStub: any = {
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

		const indexer = new Indexer(pluginStub);
		const plugin = makePluginWithIndexer(indexer);

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

		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/note.md", ctime);
		contents[file.path] = "Some content";
		await indexer.processFile(file, { reason: "modify" });

		const entry = indexer.index["2025-01-01"]?.find(e => e.file === file.path);
		expect(entry).toBeTruthy();
		indexer.setEntryHidden(entry as any, true);
		const hiddenBefore = indexer.index["2025-01-01"]?.find(e => e.file === file.path);
		expect(hiddenBefore?.reviewState).toBe("hidden");

		reviewAllDraftFiles(plugin);

		const hiddenAfter = indexer.index["2025-01-01"]?.find(e => e.file === file.path);
		expect(hiddenAfter?.reviewState).toBe("hidden");

		vi.useRealTimers();
	});

	it("Review all + Reset updates aggregated entries for cdate/content/tracked and namedate", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-11-28T09:00:00.000Z"));

		const contents: Record<string, string> = {};
		const pluginStub: any = {
			settings: {
				trackChanges: true,
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

		const indexer = new Indexer(pluginStub);
		const plugin = makePluginWithIndexer(indexer);

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

		// File with cdate anchor + content dates + tracked changes
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/note.md", ctime);
		contents[file.path] = "Review 2025-01-05 outcomes";
		await indexer.processFile(file, { reason: "modify" });

		// Create tracked entries
		contents[file.path] = "Review 2025-01-05 outcomes\nNew line";
		await indexer.processFile(file, { reason: "track" });

		// File with filename-derived date (namedate)
		const namedFile = makeFile("folder/2025-01-06.md", ctime);
		contents[namedFile.path] = "Some content";
		await indexer.processFile(namedFile, { reason: "modify" });

		// Promote drafts to reviewed via the same helper the command uses
		reviewAllDraftFiles(plugin);

		// cdate anchor entry
		const cdateKey = "2025-01-01";
		const anchor = indexer.index[cdateKey]?.find(e => e.file === file.path);
		expect(anchor?.reviewState).toBe("reviewed");

		// parsed content date entry
		const contentEntry = indexer.index["2025-01-05"]?.find(e => e.file === file.path && e.source === "content");
		expect(contentEntry?.reviewState).toBe("reviewed");

		// tracked entry
		const trackedEntry = Object.values(indexer.index)
			.flat()
			.find(e => e.file === file.path && e.source === "tracked");
		expect(trackedEntry?.reviewState).toBe("reviewed");

		// filename-derived anchor entry
		const namedAnchor = indexer.index["2025-01-06"]?.find(e => e.file === namedFile.path);
		expect(namedAnchor?.reviewState).toBe("reviewed");

		// Reset everything to Draft, ensure the same sources flip back
		resetAllReviewStates(plugin);

		const anchor2 = indexer.index[cdateKey]?.find(e => e.file === file.path);
		expect(anchor2?.reviewState).toBe("draft");
		const contentEntry2 = indexer.index["2025-01-05"]?.find(e => e.file === file.path && e.source === "content");
		expect(contentEntry2?.reviewState).toBe("draft");
		const trackedEntry2 = Object.values(indexer.index)
			.flat()
			.find(e => e.file === file.path && e.source === "tracked");
		expect(trackedEntry2?.reviewState).toBe("draft");
		const namedAnchor2 = indexer.index["2025-01-06"]?.find(e => e.file === namedFile.path);
		expect(namedAnchor2?.reviewState).toBe("draft");

		vi.useRealTimers();
	});

});
