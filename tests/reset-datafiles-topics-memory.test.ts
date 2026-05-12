import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";

describe("Reset dataFiles clears topic memory", () => {
	it("clears topic runtime cache even if topics not selected", async () => {
		const plugin: any = {
			settings: {},
			ensureIndexLoaded: vi.fn(async () => {}),
			saveSettings: vi.fn(async () => {}),
			clearEpochJsonFilesAndRebuild: vi.fn(async () => {}),
			aiBridge: {
				clearQueue: vi.fn(() => {}),
				getUrl: vi.fn(() => "")
			},
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
			refreshEpochViews: vi.fn(() => {}),
			persist: vi.fn(async () => {})
		};

		plugin.termSimilarityResetKey = 0;
		plugin.termSimilarityStoreCache = { model: "zeroshot", files: { "a.md": { term: "x" } } };
		plugin.termSimilarityStoreDirtyUpdates = 1;
		plugin.termSimilarityStoreLastWriteAt = 123;
		plugin.termSimilarityPendingFiles = new Set<string>(["a.md"]);
		plugin.termSimilarityQueueRunning = true;
		plugin.aiSummaryPendingFiles = new Set<string>(["a.md"]);
		plugin.aiSummaryQueueRunning = true;

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: true,
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

		expect(plugin.clearEpochJsonFilesAndRebuild).toHaveBeenCalledTimes(1);
		expect(plugin.aiBridge.clearQueue).toHaveBeenCalledTimes(1);
		expect(plugin.termSimilarityResetKey).toBe(1);
		expect(plugin.termSimilarityStoreCache).toBe(null);
		expect(plugin.termSimilarityStoreDirtyUpdates).toBe(0);
		expect(plugin.termSimilarityStoreLastWriteAt).toBe(0);
		expect(plugin.termSimilarityQueueRunning).toBe(false);
		expect(plugin.termSimilarityPendingFiles instanceof Set).toBe(true);
		expect(plugin.termSimilarityPendingFiles.size).toBe(0);
		expect(plugin.aiSummaryQueueRunning).toBe(false);
		expect(plugin.aiSummaryPendingFiles instanceof Set).toBe(true);
		expect(plugin.aiSummaryPendingFiles.size).toBe(0);
	});
});
