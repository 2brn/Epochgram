import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../src/indexer/indexer";
import { indexingMethods } from "../src/plugin/indexing";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";

function deferred() {
	let resolve!: () => void, reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function makePlugin(): any {
	const files = ["a.md", "b.md"].map(path => new (TFile as any)(path, { basename: path.slice(0, -3), extension: "md", stat: { ctime: Date.UTC(2026, 0, 1), mtime: Date.UTC(2026, 0, 1), size: 10 } }));
	const plugin: any = {
		settings: { summaryWordsCount: 8 }, indexReady: true, indexLoadPromise: null,
		timelineSearchIndex: new TimelineSearchIndex(),
		app: { vault: { configDir: "config", getFiles: () => files, read: vi.fn(async () => "Meeting 2026-01-05"), adapter: { exists: vi.fn(async () => false), write: vi.fn(async () => {}) } }, metadataCache: { getFileCache: () => null }, workspace: { getActiveViewOfType: () => null } },
		refreshExcludedMatchers: vi.fn(), waitForExcludedSync: vi.fn(async () => {}), shouldIndexFile: () => true,
		persist: vi.fn(async () => {}), scheduleInheritedMarkRecompute: vi.fn(), refreshEpochViews: vi.fn()
	};
	Object.assign(plugin, indexingMethods);
	plugin.indexer = new Indexer(plugin);
	return plugin;
}
describe("index operation safety", () => {
	it.each(["rebuild", "refresh"])("rolls back %s and resolves concurrent waiters on cancellation", async mode => {
		const p = makePlugin(), started = deferred(), pending = deferred();
		const oldEntry = { date: "2026-01-01", file: "old.md", source: "cdate", blockStart: 0, blockEnd: 0, summary: "original" };
		await p.indexer.load({ files: { "old.md": { cdate: oldEntry, namedDate: null, dateProp: null, contentDates: [] } }, dates: { "2026-01-01": [oldEntry] } });
		const before = p.indexer.toJSON(), oldSearch = p.timelineSearchIndex;
		oldSearch.upsert({ id: "old.md", kind: "file", path: "old.md", basename: "old", directory: "", content: "original", meta: "" });
		p.app.vault.read.mockImplementation(async (file: TFile) => {
			if (file.path === "b.md") { started.resolve(); await pending.promise; }
			return "Meeting 2026-01-05";
		});
		const operation = p.runIndexOperation(mode, { suppressNotices: true });
		await started.promise;
		const waiting = p.ensureIndexLoaded(), concurrent = p.runIndexOperation(mode, { suppressNotices: true });
		pending.reject(new Error("EPOCH_CANCELLED"));
		await expect(Promise.all([operation, waiting, concurrent])).resolves.toBeDefined();
		expect(p.indexer.toJSON()).toEqual(before);
		expect(p.timelineSearchIndex).toBe(oldSearch);
		expect(p.app.vault.read).toHaveBeenCalledTimes(2);
		expect(p.persist).not.toHaveBeenCalled();
		expect(p.app.vault.adapter.write).not.toHaveBeenCalled();
		expect(p.indexReady).toBe(true); expect(p.indexLoadPromise).toBeNull();
	});
	it("keeps waiters blocked through persistence and shares one operation", async () => {
		const p = makePlugin(), started = deferred(), pending = deferred();
		p.persist.mockImplementation(async () => { started.resolve(); await pending.promise; });
		const first = p.runIndexOperation("rebuild", { suppressNotices: true });
		await started.promise;
		let loaded = false;
		const waiter = p.ensureIndexLoaded().then(() => { loaded = true; });
		const second = p.runIndexOperation("rebuild", { suppressNotices: true });
		await Promise.resolve(); expect(loaded).toBe(false);
		pending.resolve(); await Promise.all([first, waiter, second]);
		expect(p.app.vault.read).toHaveBeenCalledTimes(2); expect(p.persist).toHaveBeenCalledOnce();
		expect(p.indexReady).toBe(true); expect(p.indexLoadPromise).toBeNull();
	});
	it("keeps new waiters blocked while the search cache commits", async () => {
		const p = makePlugin(), started = deferred(), pending = deferred();
		p.app.vault.adapter.write.mockImplementation(async () => { started.resolve(); await pending.promise; });
		const operation = p.runIndexOperation("rebuild", { suppressNotices: true });
		await started.promise;
		let loaded = false;
		const waiter = p.ensureIndexLoaded().then(() => { loaded = true; });
		await Promise.resolve(); expect(loaded).toBe(false);
		pending.resolve(); await Promise.all([operation, waiter]);
		expect(loaded).toBe(true);
	});
	it("does not wait on excluded sync during startup fallback rebuild", async () => {
		const p = makePlugin(); p.indexReady = false;
		p.waitForExcludedSync.mockImplementation(() => new Promise(() => {}));
		await p.runIndexOperation("rebuild", { skipEnsure: true, suppressNotices: true });
		expect(p.waitForExcludedSync).not.toHaveBeenCalled(); expect(p.indexReady).toBe(true);
	});
	it("restores the prior search index on non-cancellation errors", async () => {
		const p = makePlugin(), previous = p.timelineSearchIndex;
		p.app.vault.read.mockRejectedValueOnce(new Error("read failed"));
		await expect(p.runIndexOperation("rebuild", { suppressNotices: true })).rejects.toThrow("read failed");
		expect(p.timelineSearchIndex).toBe(previous); expect(p.indexReady).toBe(true); expect(p.indexLoadPromise).toBeNull();
	});
});
