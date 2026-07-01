import { describe, it, expect, vi } from "vitest";
import { Platform, TFile } from "obsidian";

import { runReset } from "../src/plugin/maintenance";
import { DEFAULT_SIMILARITY_MODEL } from "../src/plugin/similarity/config";
import { runSimilarityStartupMaintenance } from "../src/plugin/similarity/startup-maintenance";
import { withTrustedPro } from "./helpers/trusted-pro";

// Create a fake TFile class that can be used for instanceof checks
class FakeTFile {
	path: string;
	stat: any;
	extension?: string;
	constructor(path: string, stat: any = {}) {
		this.path = path;
		this.stat = stat;
		const lastDot = path.lastIndexOf(".");
		this.extension = lastDot > -1 ? path.slice(lastDot + 1) : "";
	}
}
// Make instanceof work by setting the prototype
Object.setPrototypeOf(FakeTFile.prototype, TFile.prototype);

describe("Reset semantics", () => {
	it("clears the vectors store and resets in-memory similarity state", async () => {
		Platform.isDesktopApp = true;
		Platform.isMobileApp = false;
		const fileStore = new Map<string, string>();
		const adapter = {
			write: vi.fn(async (p: string, data: string) => {
				fileStore.set(p, data);
			})
		};

		const plugin: any = {
			proActive: true,
			manifest: { id: "epochgram", version: "0.4.3-test" },
			indexer: {
				getIndexedPaths: () => []
			},
			hasProAccess: () => true,
			settings: { similarityThreshold: 0.5 },
			ensureIndexLoaded: vi.fn(async () => {}),
			saveSettings: vi.fn(async () => {}),
			persist: vi.fn(async () => {}),
			refreshEpochViews: vi.fn(() => {}),
			app: {
				vault: {
					adapter,
					getFiles: () => [new FakeTFile("a.md"), new FakeTFile("b.md")],
					getMarkdownFiles: () => [new FakeTFile("a.md"), new FakeTFile("b.md")]
				}
			},
			shouldIndexFile: () => true,
			vectorsFilePath: "epochgram-semantics.json",
			similarityIndex: {
				model: "old",
				dim: 384,
				files: {
					"a.md": { v: [0.1, 0.2], updatedAt: 1 }
				}
			},
			similarityVectorsLoaded: false,
			similarityQueueTimer: setTimeout(() => {}, 5000),
			similarityPendingFiles: new Set(["a.md"]),
			similarityQueueTotal: 123,
			similarityQueueProcessed: 45,
			similarityVectorUpdateStartedAt: 999,
			similarityStoreRev: 7,
			queueVectorUpdate: vi.fn(),
			__epochDidSimilarityStartupMaintenance: true,
			__epochHugeSimilarityBackfillTimer: setTimeout(() => {}, 5000),
			__epochHugeSimilarityBackfillFiles: [{ path: "x.md" }],
			__epochHugeSimilarityBackfillIndex: 123,
			__epochHugeSimilarityBackfillRunning: true
		};
		withTrustedPro(plugin);

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: true,
				topics: false,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(adapter.write).toHaveBeenCalledTimes(1);
		expect(fileStore.has("epochgram-semantics.json")).toBe(true);
		expect(JSON.parse(fileStore.get("epochgram-semantics.json") ?? "")).toEqual({ models: {} });

		expect(plugin.similarityVectorsLoaded).toBe(true);
		expect(plugin.similarityIndex).toEqual({ model: DEFAULT_SIMILARITY_MODEL, dim: 0, files: {} });
		expect(plugin.similarityPendingFiles instanceof Set).toBe(true);
		expect(Array.from(plugin.similarityPendingFiles)).toEqual([]);
		expect(plugin.similarityQueueTotal).toBe(0);
		expect(plugin.similarityQueueProcessed).toBe(0);
		expect(plugin.similarityVectorUpdateStartedAt).toBe(0);
		expect(plugin.similarityQueueTimer).toBe(null);
		expect(plugin.similarityStoreRev).toBe(8);

		expect(plugin.__epochDidSimilarityStartupMaintenance).toBe(undefined);
		expect(plugin.__epochHugeSimilarityBackfillTimer).toBe(null);
		expect(plugin.__epochHugeSimilarityBackfillFiles).toBe(null);
		expect(plugin.__epochHugeSimilarityBackfillIndex).toBe(0);
		expect(plugin.__epochHugeSimilarityBackfillRunning).toBe(false);

		vi.useFakeTimers();
		const p = runSimilarityStartupMaintenance(plugin);
		await vi.runAllTimersAsync();
		await p;
		await vi.runAllTimersAsync();
		vi.useRealTimers();
		expect(plugin.__epochDidSimilarityStartupMaintenance).toBe(true);
		expect(plugin.queueVectorUpdate).toHaveBeenCalledTimes(2);
	});
});
