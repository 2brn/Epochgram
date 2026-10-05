import { describe, expect, it, vi } from "vitest";
import { mergeReviewStatesForSync } from "../src/indexer/review-state-sync";
import { persistenceMethods } from "../src/plugin/persistence";
import type { SerializedEpochIndex } from "../src/indexer/types";

const PATH = "Notes/sync.md";
const DATE = "2026-10-05";

type State = "draft" | "reviewed" | "hidden";

function makeIndex(options: {
	state: State;
	updatedAt?: number;
	contentHash?: string;
	bodyHash?: string;
}): SerializedEpochIndex {
	const fileEntry: any = {
		date: DATE,
		file: PATH,
		blockStart: 0,
		blockEnd: 0,
		summary: "Sync note",
		source: "cdate"
	};
	const dateEntry: any = { ...fileEntry, reviewState: "draft" };
	if (options.state !== "draft") {
		fileEntry.reviewState = options.state;
		dateEntry.reviewState = options.state;
	}
	if (options.updatedAt != null) {
		fileEntry.reviewStateUpdatedAt = options.updatedAt;
		dateEntry.reviewStateUpdatedAt = options.updatedAt;
	}
	return {
		files: {
			[PATH]: {
				cdate: fileEntry,
				namedDate: null,
				dateProp: null,
				contentDates: [],
				trackedDates: {},
				trackedSnapshot: null,
				trackedSnapshotDate: null,
				trackedBaselineSnapshot: null,
				trackedBaselineDate: null,
				contentHash: options.contentHash,
				bodyHash: options.bodyHash
			}
		},
		dates: { [DATE]: [dateEntry] }
	} as SerializedEpochIndex;
}

class MemoryAdapter {
	private readonly files = new Map<string, string>();

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value == null) throw new Error(`Missing ${path}`);
		return value;
	}

	async write(path: string, value: string): Promise<void> {
		this.files.set(path, value);
	}

	async mkdir(_path: string): Promise<void> {
		// no-op
	}
}

class InterleavingAdapter extends MemoryAdapter {
	private reads = 0;

	constructor(private readonly replacement: string) {
		super();
	}

	async read(path: string): Promise<string> {
		const current = await super.read(path);
		this.reads++;
		if (this.reads === 1) await super.write(path, this.replacement);
		return current;
	}
}

describe("review state Sync reconciliation", () => {
	it("keeps a legacy Reviewed state when an unchanged synced index says Draft", () => {
		const syncedDraft = makeIndex({ state: "draft", contentHash: "same", bodyHash: "same-body" });
		const localReviewed = makeIndex({ state: "reviewed", contentHash: "same", bodyHash: "same-body" });

		expect(mergeReviewStatesForSync(syncedDraft, localReviewed)).toBe(true);
		expect(syncedDraft.files[PATH]?.cdate?.reviewState).toBe("reviewed");
		expect(syncedDraft.dates[DATE]?.[0]?.reviewState).toBe("reviewed");
	});

	it("honors a newer explicit Draft mutation from another device", () => {
		const localReviewed = makeIndex({ state: "reviewed", updatedAt: 100, contentHash: "same" });
		const syncedDraft = makeIndex({ state: "draft", updatedAt: 200, contentHash: "same" });

		expect(mergeReviewStatesForSync(localReviewed, syncedDraft)).toBe(true);
		expect(localReviewed.files[PATH]?.cdate?.reviewState).toBeUndefined();
		expect(localReviewed.files[PATH]?.cdate?.reviewStateUpdatedAt).toBe(200);
		expect(localReviewed.dates[DATE]?.[0]?.reviewState).toBe("draft");
	});

	it("does not resurrect a cleared recurring review from a stale Sync snapshot", () => {
		const localCleared = makeIndex({ state: "draft", contentHash: "same" });
		(localCleared.files[PATH] as any).recurReviewedDates = [];
		(localCleared.files[PATH] as any).recurReviewedDatesUpdatedAt = 200;
		const syncedReviewed = makeIndex({ state: "draft", contentHash: "same" });
		(syncedReviewed.files[PATH] as any).recurReviewedDates = [DATE];
		(syncedReviewed.files[PATH] as any).recurReviewedDatesUpdatedAt = 100;

		mergeReviewStatesForSync(localCleared, syncedReviewed);
		expect((localCleared.files[PATH] as any).recurReviewedDates).toEqual([]);
		expect((localCleared.files[PATH] as any).recurReviewedDatesUpdatedAt).toBe(200);
	});

	it("preserves review state across a frontmatter-only revision", () => {
		const localDraft = makeIndex({ state: "draft", contentHash: "frontmatter-v2", bodyHash: "body" });
		const syncedReviewed = makeIndex({ state: "reviewed", contentHash: "frontmatter-v1", bodyHash: "body" });

		mergeReviewStatesForSync(localDraft, syncedReviewed);
		expect(localDraft.files[PATH]?.cdate?.reviewState).toBe("reviewed");
	});

	it("does not carry review state across a real content revision", () => {
		const localDraft = makeIndex({ state: "draft", contentHash: "content-v2", bodyHash: "body-v2" });
		const syncedReviewed = makeIndex({ state: "reviewed", contentHash: "content-v1", bodyHash: "body-v1" });

		expect(mergeReviewStatesForSync(localDraft, syncedReviewed)).toBe(false);
		expect(localDraft.files[PATH]?.cdate?.reviewState).toBeUndefined();
	});

	it("re-reads immediately before write when Sync arrives during reconciliation", async () => {
		const initialDraft = makeIndex({ state: "draft", contentHash: "same" });
		const syncedReviewed = makeIndex({ state: "reviewed", contentHash: "same" });
		const localDraft = makeIndex({ state: "draft", contentHash: "same" });
		(localDraft.files[PATH] as any).indexedSize = 42;
		const adapter = new InterleavingAdapter(JSON.stringify(syncedReviewed));
		await adapter.write("epochgram-index.json", JSON.stringify(initialDraft));

		const load = vi.fn(async () => {});
		const plugin: any = {
			app: { vault: { adapter } },
			indexFilePath: "epochgram-index.json",
			pluginDirEnsured: true,
			ensurePluginDir: async () => {},
			updateIndexFileStat: async () => {},
			indexer: { load }
		};

		await persistenceMethods.writeIndexToDisk.call(plugin, localDraft);

		const saved = JSON.parse(await adapter.read("epochgram-index.json")) as SerializedEpochIndex;
		expect(saved.files[PATH]?.cdate?.reviewState).toBe("reviewed");
		expect(saved.files[PATH]?.indexedSize).toBe(42);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("rebases a pending write onto the index currently delivered by Sync", async () => {
		const adapter = new MemoryAdapter();
		const syncedReviewed = makeIndex({ state: "reviewed", contentHash: "same" });
		const localDraft = makeIndex({ state: "draft", contentHash: "same" });
		(localDraft.files[PATH] as any).indexedSize = 42;
		await adapter.write("epochgram-index.json", JSON.stringify(syncedReviewed));

		const load = vi.fn(async () => {});
		const plugin: any = {
			app: { vault: { adapter } },
			indexFilePath: "epochgram-index.json",
			pluginDirEnsured: true,
			ensurePluginDir: async () => {},
			updateIndexFileStat: async () => {},
			indexer: { load }
		};

		await persistenceMethods.writeIndexToDisk.call(plugin, localDraft);

		const saved = JSON.parse(await adapter.read("epochgram-index.json")) as SerializedEpochIndex;
		expect(saved.files[PATH]?.cdate?.reviewState).toBe("reviewed");
		expect(load).toHaveBeenCalledTimes(1);
	});
});
