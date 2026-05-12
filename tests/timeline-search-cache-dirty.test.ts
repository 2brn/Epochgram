import { describe, expect, it, vi } from "vitest";

import { markTimelineSearchIndexDirty, saveTimelineSearchCache } from "../src/plugin/timeline-search-cache";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";

function makeAdapter(initial: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(initial));
	return {
		exists: vi.fn(async (p: string) => files.has(p)),
		read: vi.fn(async (p: string) => files.get(p) ?? ""),
		write: vi.fn(async (p: string, payload: string) => {
			files.set(p, payload);
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		})
	};
}

describe("timeline search cache", () => {
	it("does not write epochgram-search.json when cache is not dirty", async () => {
		const configDir = "config";
		const cachePath = `${configDir}/epochgram-search.json`;

		const adapter = makeAdapter({ [cachePath]: JSON.stringify({ a: 1 }) });
		const plugin: any = {
			app: { vault: { configDir, adapter } },
			timelineSearchIndex: { serialize: () => ({ a: 2 }) }
		};

		await saveTimelineSearchCache(plugin);
		expect(adapter.write).toHaveBeenCalledTimes(0);
	});

	it("writes once when dirty, then clears dirty", async () => {
		const configDir = "config";
		const cachePath = `${configDir}/epochgram-search.json`;

		const adapter = makeAdapter({ [cachePath]: JSON.stringify({ a: 1 }) });
		const plugin: any = {
			app: { vault: { configDir, adapter } },
			timelineSearchIndex: { serialize: () => ({ a: 2 }) }
		};

		markTimelineSearchIndexDirty(plugin);
		await saveTimelineSearchCache(plugin);
		expect(adapter.write).toHaveBeenCalledTimes(1);

		await saveTimelineSearchCache(plugin);
		expect(adapter.write).toHaveBeenCalledTimes(1);
	});

	it("does not write for no-op upsert and no-op remove", async () => {
		const configDir = "config";
		const cachePath = `${configDir}/epochgram-search.json`;

		const index = new TimelineSearchIndex();
		const doc = {
			id: "notes/a.md",
			kind: "file" as const,
			path: "notes/a.md",
			basename: "a",
			directory: "notes",
			content: "hello world",
			meta: "ext:md"
		};

		const first = index.upsert(doc);
		expect(first).toBe(true);

		const initialPayload = JSON.stringify(index.serialize());
		const adapter = makeAdapter({ [cachePath]: initialPayload });
		const plugin: any = {
			app: { vault: { configDir, adapter } },
			timelineSearchIndex: index,
			__timelineSearchCacheDirty: false,
			__timelineSearchCacheDiskLoaded: true,
			__timelineSearchCacheDiskPayload: initialPayload,
			__timelineSearchCacheLastPayload: initialPayload
		};

		const upsertNoop = index.upsert({ ...doc });
		expect(upsertNoop).toBe(false);
		await saveTimelineSearchCache(plugin);
		expect(adapter.write).toHaveBeenCalledTimes(0);

		const removeNoop = index.removeById("notes/missing.md");
		expect(removeNoop).toBe(false);
		await saveTimelineSearchCache(plugin);
		expect(adapter.write).toHaveBeenCalledTimes(0);
	});
});
