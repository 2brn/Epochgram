import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";
describe("Reset search clears cache save timer", () => {
	it("cancels scheduled timeline-search cache save", async () => {
		const plugin: any = {
			settings: {}, ensureIndexLoaded: vi.fn(async () => {}), refreshEpochViews: vi.fn(),
			app: { vault: { configDir: "config", adapter: { exists: vi.fn(async () => false), remove: vi.fn(async () => {}) } }, workspace: { getLeavesOfType: () => [] } },
			timelineSearchIndex: { clear: vi.fn(), serialize: vi.fn(() => "{}") },
			__timelineSearchCacheSaveTimer: 12345, __timelineSearchCacheWritePromise: Promise.resolve()
		};
		await runReset(plugin, { settings: false, search: true, dataFiles: false });
		expect(plugin.__timelineSearchCacheSaveTimer).toBeNull(); expect(plugin.__timelineSearchCacheWritePromise).toBeNull();
	});
});
