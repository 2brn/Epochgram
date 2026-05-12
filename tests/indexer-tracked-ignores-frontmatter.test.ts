import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../src/indexer/indexer";

const TEST_TIME = "2025-11-28T09:00:00.000Z";

const makeFile = (path: string): TFile => {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		name,
		extension,
		basename,
		stat: { ctime: Date.now(), mtime: Date.now(), size: 0 }
	});
};

describe("tracked changes ignores YAML frontmatter", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;
	const file = makeFile("folder/note.md");

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(TEST_TIME));
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
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const trackedEntriesForFile = (path: string) => {
		return Object.values(indexer.index)
			.flat()
			.filter(entry => entry.file === path && entry.source === "tracked");
	};

	it("does not create tracked entries for frontmatter-only edits", async () => {
		const original = [
			"---",
			"tags: [alpha]",
			"---",
			"hello"
		].join("\n");
		contents[file.path] = original;

		await indexer.processFile(file, { reason: "modify" });
		expect(trackedEntriesForFile(file.path)).toHaveLength(0);

		// Only YAML frontmatter changes.
		contents[file.path] = [
			"---",
			"tags: [bravo]",
			"---",
			"hello"
		].join("\n");
		await indexer.processFile(file, { reason: "track" });
		expect(trackedEntriesForFile(file.path)).toHaveLength(0);

		// Body changes should still be tracked.
		contents[file.path] = [
			"---",
			"tags: [bravo]",
			"---",
			"hello",
			"world"
		].join("\n");
		await indexer.processFile(file, { reason: "track" });

		const entries = trackedEntriesForFile(file.path);
		expect(entries).toHaveLength(1);
		expect(String(entries[0]?.trackedChange ?? "")).toBe("added");
		expect(String(entries[0]?.summary ?? "")).toContain("world");
	});
});
