import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

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

describe("ReviewState preserved on disk reload", () => {
	let indexer: Indexer;
	let indexer2: Indexer;
	let pluginStub: any;
	let pluginStub2: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-12T09:00:00.000Z"));
		contents = {};
		pluginStub = {
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
		pluginStub2 = {
			settings: pluginStub.settings,
			hasProAccess: () => false,
			app: pluginStub.app
		};
		indexer = new Indexer(pluginStub);
		indexer2 = new Indexer(pluginStub2);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps Reviewed across load(), and no-op modify stays Reviewed", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/sync-touch.md", ctime);

		contents[file.path] = "Line1\nLine2";
		await indexer.processFile(file, { reason: "modify" });

		const data: any = (indexer as any).files[file.path];
		if (data.cdate) (data.cdate as any).reviewState = "reviewed";
		// Legacy field should be ignored/dropped on load.
		data.reviewByDate = { "2025-01-01": "reviewed" };
		(indexer as any).updateAggregatedEntries(file.path);

		const serialized = indexer.toJSON();
		await indexer2.load(serialized as any);

		const loaded: any = (indexer2 as any).files[file.path];
		expect(loaded.reviewByDate).toBeUndefined();
		expect(String((loaded.cdate as any)?.reviewState ?? "")).toBe("reviewed");
		expect(typeof loaded.contentHash).toBe("string");
		expect(String(loaded.contentHash || "").trim().length).toBeGreaterThan(0);

		// Simulate Sync touching the file without content changes.
		contents[file.path] = "Line1\r\nLine2";
		await indexer2.processFile(file, { reason: "modify" });

		const loaded2: any = (indexer2 as any).files[file.path];
		expect(String((loaded2.cdate as any)?.reviewState ?? "")).toBe("reviewed");
	});
});
