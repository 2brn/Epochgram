import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";

function makePluginWithIndexer(overrides: Partial<any> = {}) {
	const plugin: any = {
		settings: {},
		ensureIndexLoaded: vi.fn(async () => {}),
		saveSettings: vi.fn(async () => {}),
		persist: vi.fn(async () => {}),
		refreshEpochViews: vi.fn(() => {}),
		indexer: {
			files: {},
			index: {},
			getIndexedPaths: () => [],
			getFileMarkColor: vi.fn(() => null),
			setFileMarkColor: vi.fn(() => false),
			getFileEmbeddingTerm: vi.fn(() => ""),
			setFileEmbeddingTerm: vi.fn(() => false),
			clearTrackedChanges: vi.fn(() => false)
		},
		clearInheritedMarksCache: vi.fn(() => {})
	};
	Object.assign(plugin, overrides);
	return plugin;
}

describe("Reset actions", () => {
	it("can run reset twice (in-flight flag is cleared)", async () => {
		const plugin = makePluginWithIndexer({
			refreshLicenseState: vi.fn(() => {}),
			hasProAccess: vi.fn(() => false),
			viewPreferences: {},
			settings: {}
		});

		await runReset(
			plugin,
			{
				settings: true,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		await runReset(
			plugin,
			{
				settings: true,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});

	it("resets filenameWordsCount to default 2", async () => {
		const plugin = makePluginWithIndexer({
			refreshLicenseState: vi.fn(() => {}),
			hasProAccess: vi.fn(() => false),
			viewPreferences: {},
			settings: {
				filenameWordsCount: 0
			}
		});

		await runReset(
			plugin,
			{
				settings: true,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(plugin.settings.filenameWordsCount).toBe(2);
	});

	it("clears marks (explicit) and drops inherited cache", async () => {
		const markByPath = new Map<string, number | null>([
			["a.md", 2],
			["b.md", null]
		]);
		const plugin = makePluginWithIndexer({
			indexer: {
				files: {},
				index: {},
				getIndexedPaths: () => ["a.md", "b.md"],
				getFileMarkColor: (p: string) => markByPath.get(p) ?? null,
				setFileMarkColor: (p: string, v: any) => {
					const prev = markByPath.get(p) ?? null;
					markByPath.set(p, v);
					return prev !== v;
				},
				clearTrackedChanges: vi.fn(() => false)
			}
		});

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: true,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(markByPath.get("a.md")).toBe(null);
		expect(plugin.clearInheritedMarksCache).toHaveBeenCalledTimes(1);
		expect(plugin.persist).toHaveBeenCalledTimes(1);
		expect(plugin.refreshEpochViews).toHaveBeenCalledTimes(1);
	});

	it("clears ai summaries", async () => {
		const updateAggregatedEntries = vi.fn(() => {});
		const plugin = makePluginWithIndexer({
			indexer: {
				files: {
					"a.md": {
						cdate: { file: "a.md", date: "2020-01-01", aiSummary: "ai", aiSummaryInputHash: "h" },
						contentDates: [{ file: "a.md", date: "2020-01-01", aiSummary: "ai2", aiSummaryInputHash: "h2" }]
					}
				},
				index: {
					"2020-01-01": [
						{ file: "a.md", date: "2020-01-01", source: "content", aiSummary: "aiIndex", aiSummaryInputHash: "hi" }
					]
				},
				updateAggregatedEntries,
				getIndexedPaths: () => ["a.md"],
				getFileMarkColor: vi.fn(() => null),
				setFileMarkColor: vi.fn(() => false),
				getFileEmbeddingTerm: vi.fn(() => ""),
				setFileEmbeddingTerm: vi.fn(() => false),
				clearTrackedChanges: vi.fn(() => false)
			}
		});
		(plugin as any).aiSummaryPendingFiles = new Set(["a.md"]);
		(plugin as any).aiSummaryQueueRunning = true;
		(plugin as any).epochRegenAfterAiTimer = setInterval(() => {}, 50);
		(plugin as any).epochRegenAfterAiMode = "force";
		(plugin as any).epochRegenAfterAiAll = true;
		(plugin as any).epochRegenAfterAiDateKeys = new Set(["2020-01-01"]);
		(plugin as any).epochRegenAfterAiBuckets = new Set(["week"]);
		(plugin as any).epochRegenAfterAiShowQueuedNotice = true;
		const throttleTimer: any = setTimeout(() => {}, 5_000);
		(plugin as any).aiSummaryEnqueueThrottleByFile = new Map([
			[
				"a.md",
				{
					lastQueuedAt: Date.now(),
					timerId: throttleTimer,
					pendingJobs: [{ id: "j1", filePath: "a.md", kind: "summary", input: "x" }]
				}
			]
		]);

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: true,
				epochs: false
			},
			{ keepLicense: true }
		);

		const data = plugin.indexer.files["a.md"];
		expect(data.cdate.aiSummary).toBeUndefined();
		expect(data.cdate.aiSummaryInputHash).toBeUndefined();
		expect(data.contentDates[0].aiSummary).toBeUndefined();
		expect(data.contentDates[0].aiSummaryInputHash).toBeUndefined();
		expect(plugin.indexer.index["2020-01-01"][0].aiSummary).toBeUndefined();
		expect(plugin.indexer.index["2020-01-01"][0].aiSummaryInputHash).toBeUndefined();
		expect(updateAggregatedEntries).toHaveBeenCalled();
		expect((plugin as any).aiSummaryPendingFiles instanceof Set).toBe(true);
		expect((plugin as any).aiSummaryPendingFiles.size).toBe(0);
		expect((plugin as any).aiSummaryQueueRunning).toBe(false);
		expect((plugin as any).epochRegenAfterAiTimer).toBe(null);
		expect((plugin as any).epochRegenAfterAiMode).toBe(null);
		expect((plugin as any).epochRegenAfterAiAll).toBe(false);
		expect((plugin as any).epochRegenAfterAiDateKeys).toBe(null);
		expect((plugin as any).epochRegenAfterAiBuckets).toBe(null);
		expect((plugin as any).epochRegenAfterAiShowQueuedNotice).toBe(false);
		expect((plugin as any).aiSummaryEnqueueThrottleByFile?.size ?? 0).toBe(0);
	});

	it("clears epoch entries from index", async () => {
		const plugin = makePluginWithIndexer({
			aiBridge: {
				clearQueue: vi.fn(() => {}),
				getUrl: vi.fn(() => "")
			},
			indexer: {
				files: {},
				index: {
					"2020-01-01": [
						{ file: "a.md", date: "2020-01-01", source: "content" },
						{ file: "epoch://x", date: "2020-01-01", source: "epoch" }
					]
				},
				getIndexedPaths: () => [],
				getFileMarkColor: vi.fn(() => null),
				setFileMarkColor: vi.fn(() => false),
				getFileEmbeddingTerm: vi.fn(() => ""),
				setFileEmbeddingTerm: vi.fn(() => false),
				clearTrackedChanges: vi.fn(() => false)
			}
		});
		(plugin as any).epochRegenAfterAiTimer = setInterval(() => {}, 50);
		(plugin as any).epochRegenAfterAiMode = "force";
		(plugin as any).epochRegenAfterAiAll = true;
		(plugin as any).epochRegenAfterAiDateKeys = new Set(["2020-01-01"]);
		(plugin as any).epochRegenAfterAiBuckets = new Set(["week"]);
		(plugin as any).epochRegenAfterAiShowQueuedNotice = true;

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: true
			},
			{ keepLicense: true }
		);

		expect(plugin.indexer.index["2020-01-01"].length).toBe(1);
		expect(plugin.indexer.index["2020-01-01"][0].file).toBe("a.md");
		expect((plugin as any).aiBridge.clearQueue).toHaveBeenCalledTimes(1);
		expect((plugin as any).epochRegenAfterAiTimer).toBe(null);
		expect((plugin as any).epochRegenAfterAiMode).toBe(null);
		expect((plugin as any).epochRegenAfterAiAll).toBe(false);
		expect((plugin as any).epochRegenAfterAiDateKeys).toBe(null);
		expect((plugin as any).epochRegenAfterAiBuckets).toBe(null);
		expect((plugin as any).epochRegenAfterAiShowQueuedNotice).toBe(false);
	});

	it("resets reviews to Draft", async () => {
		const files: any = {
			"a.md": { contentDates: [{ reviewState: "reviewed" }] },
			"b.md": { contentDates: [{ reviewState: "reviewed" }], recurReviewedDates: ["2025-01-02"] },
			"c.md": {}
		};
		const clearFileReviewOverrides = vi.fn((p: string) => {
			if (!files[p]) return false;
			let changed = false;
			if (Array.isArray(files[p].contentDates)) {
				for (const e of files[p].contentDates) {
					if (e && e.reviewState === "reviewed") {
						delete e.reviewState;
						changed = true;
					}
				}
			}
			if (Array.isArray(files[p].recurReviewedDates) && files[p].recurReviewedDates.length > 0) {
				files[p].recurReviewedDates = [];
				changed = true;
			}
			return changed;
		});
		const plugin = makePluginWithIndexer({
			indexer: {
				files,
				index: {},
				getIndexedPaths: () => ["a.md", "b.md", "c.md"],
				clearFileReviewOverrides,
				clearTrackedChanges: vi.fn(() => false)
			}
		});

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: true,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(files["a.md"].contentDates?.[0]?.reviewState).toBeUndefined();
		expect(files["b.md"].contentDates?.[0]?.reviewState).toBeUndefined();
		expect(files["b.md"].recurReviewedDates).toEqual([]);
		expect(clearFileReviewOverrides).toHaveBeenCalled();
		expect(plugin.persist).toHaveBeenCalledTimes(1);
		expect(plugin.refreshEpochViews).toHaveBeenCalledTimes(1);
	});

	it("clears pinned file flags (unpins everything)", async () => {
		const files: any = {
			"a.md": { pinnedFile: true },
			"b.md": { pinnedFile: false }
		};
		const setFilePinned = vi.fn((p: string, pinned: boolean) => {
			const desired = pinned === true;
			if ((files[p]?.pinnedFile === true) === desired) return false;
			files[p].pinnedFile = desired;
			return true;
		});
		const plugin = makePluginWithIndexer({
			indexer: {
				files,
				index: {},
				getIndexedPaths: () => ["a.md", "b.md"],
				isFilePinned: (p: string) => files[p]?.pinnedFile === true,
				setFilePinned,
				clearTrackedChanges: vi.fn(() => false)
			}
		});

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: true,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(files["a.md"].pinnedFile).toBe(false);
		expect(setFilePinned).toHaveBeenCalledTimes(1);
	});

	it("resets search (index)", async () => {
		const clear = vi.fn(() => {});
		const setSearchQueryInternal = vi.fn(() => {});
		const view: any = {
			searchQuery: "hello",
			setSearchQueryInternal
		};
		const leaf: any = { view };
		const plugin = makePluginWithIndexer({
			settings: {
				timelineSearchQuery: "hello"
			},
			timelineSearchIndex: { clear },
			app: {
				workspace: {
					getLeavesOfType: vi.fn(() => [leaf])
				}
			},
			__timelineSearchIndexVersion: 41
		});

		await runReset(
			plugin,
			{
				settings: false,
				search: true,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(clear).toHaveBeenCalledTimes(1);
		expect((plugin.settings as any).timelineSearchQuery).toBe("hello");
		expect(setSearchQueryInternal).toHaveBeenCalledTimes(1);
		expect(setSearchQueryInternal).toHaveBeenCalledWith("");
		expect(Number((plugin as any).__timelineSearchIndexVersion)).toBe(42);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.persist).toHaveBeenCalledTimes(1);
		expect(plugin.refreshEpochViews).toHaveBeenCalledTimes(1);
	});
});
