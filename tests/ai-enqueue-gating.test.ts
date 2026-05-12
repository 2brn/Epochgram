import { describe, it, expect, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "./obsidian-mock";

describe("AI enqueue gating", () => {
	const makePlugin = () => {
		const plugin: any = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 5,
				summarizeAI: true
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async () => "# Title\n\nSome content here")
				},
				workspace: {
					getActiveViewOfType: vi.fn(() => null)
				}
			},
			enqueueAiSummariesForFile: vi.fn()
		};
		return plugin;
	};

	it("does not enqueue AI during rebuild processing", async () => {
		const plugin = makePlugin();
		const indexer = new Indexer(plugin);
		const file: any = new TFile("note.md", { extension: "md" });

		await indexer.processFile(file, { reason: "rebuild" });

		expect(plugin.enqueueAiSummariesForFile).not.toHaveBeenCalled();
	});

	it("enqueues AI on modify processing", async () => {
		const plugin = makePlugin();
		const indexer = new Indexer(plugin);
		const file: any = new TFile("note.md", { extension: "md" });

		await indexer.processFile(file, { reason: "modify" });

		expect(plugin.enqueueAiSummariesForFile).toHaveBeenCalledTimes(1);
		expect(plugin.enqueueAiSummariesForFile).toHaveBeenCalledWith("note.md");
	});
});
