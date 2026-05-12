import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../src/indexer/indexer";

const BASELINE_TIME = "2025-11-18T09:00:00.000Z";
const TODAY_TIME = "2025-11-28T09:00:00.000Z";
const REMOTE_EDIT_TIME = "2025-11-22T09:00:00.000Z";

const makeFile = (path: string, mtimeMs: number): TFile => {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		name,
		extension,
		basename,
		stat: { ctime: mtimeMs, mtime: mtimeMs, size: 0 }
	});
};

describe("tracked changes sync bucketing", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;
	let file: TFile;

	beforeEach(() => {
		vi.useFakeTimers();
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 5
			},
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? "")
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);

		const baselineMs = Date.parse(BASELINE_TIME);
		file = makeFile("folder/note.md", baselineMs);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("buckets tracked changes under file mtime day after a long gap", async () => {
		// Device last indexed the file a while ago.
		vi.setSystemTime(new Date(BASELINE_TIME));
		contents[file.path] = "alpha";
		await indexer.processFile(file, { reason: "modify" });

		// Later (today), sync brings a remote edit from an earlier day.
		vi.setSystemTime(new Date(TODAY_TIME));
		(file as any).stat.mtime = Date.parse(REMOTE_EDIT_TIME);
		contents[file.path] = "alpha\nbravo";
		await indexer.processFile(file, { reason: "track" });

		const tracked = Object.values(indexer.index)
			.flat()
			.filter(entry => entry.source === "tracked" && entry.file === file.path);
		expect(tracked.length).toBe(1);
		expect(tracked[0]?.date).toBe("2025-11-22");
	});
});
