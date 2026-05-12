import { describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
import { TFile } from "obsidian";

describe("epochgram export html indexing", () => {
	const makeFile = (path: string): TFile => {
		const name = path.split("/").pop() ?? path;
		const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
		const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
		const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
		return new Ctor(path, {
			basename,
			extension,
			stat: {
				ctime: Date.UTC(2026, 1, 18),
				mtime: Date.UTC(2026, 1, 18),
				size: 123
			}
		});
	};

	it("indexes epochgram-*.html by filename only (does not read content)", async () => {
		const vaultRead = vi.fn(async () => "SHOULD_NOT_BE_READ uniqueexportcontenttoken");
		const pluginStub: any = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: false
			},
			hasProAccess: () => true,
			timelineSearchIndex: new TimelineSearchIndex(),
			app: {
				vault: {
					read: vaultRead
				},
				workspace: {
					getActiveViewOfType: vi.fn(() => null)
				}
			}
		};

		const indexer = new Indexer(pluginStub);
		const file = makeFile("Daily/epochgram-2026-02-16.html");

		await indexer.processFile(file, { reason: "modify" });

		// Treat as non-text: do not read file contents.
		expect(vaultRead).not.toHaveBeenCalled();

		// Search should match by filename/path.
		const idx = pluginStub.timelineSearchIndex as TimelineSearchIndex;
		const byName = idx.searchFileIds({ includeText: "epochgram 2026 02 16", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(byName.has(file.path)).toBe(true);

		// But it should not match content-only tokens.
		const byContent = idx.searchFileIds({ includeText: "uniqueexportcontenttoken", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(byContent.has(file.path)).toBe(false);
	});
});
