import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";

describe("Reset search clears cache save timer", () => {
	it("cancels scheduled timeline-search cache save", async () => {
		const fileStore = new Map<string, string>();
		const adapter = {
			exists: vi.fn(async (_p: string) => false),
			read: vi.fn(async (_p: string) => fileStore.get(_p) ?? ""),
			write: vi.fn(async (_p: string, data: string) => {
				fileStore.set(_p, data);
			}),
			remove: vi.fn(async (_p: string) => {
				fileStore.delete(_p);
			})
		};
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
			app: { vault: { adapter, configDir: "config" } },
			timelineSearchIndex: { clear: vi.fn(() => {}), loadSerialized: vi.fn(() => true), serialize: vi.fn(() => "{}") }
		};

		plugin.__timelineSearchCacheSaveTimer = 12345;
		plugin.__timelineSearchCacheWritePromise = Promise.resolve();

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

		expect(plugin.__timelineSearchCacheSaveTimer).toBe(null);
		expect(plugin.__timelineSearchCacheWritePromise).toBe(null);
	});
});
