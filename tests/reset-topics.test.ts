import { describe, it, expect, vi } from "vitest";
import { runReset } from "../src/plugin/maintenance";
import { DEFAULT_ZERO_SHOT_MODEL } from "../src/plugin/similarity/config";

describe("Reset topics", () => {
	it("clears embedding terms and in-memory term store", async () => {
		const fileStore = new Map<string, string>();
		const adapter = {
			exists: vi.fn(async (p: string) => fileStore.has(p)),
			read: vi.fn(async (p: string) => fileStore.get(p) ?? ""),
			write: vi.fn(async (p: string, data: string) => {
				fileStore.set(p, data);
			})
		};

		const embeddingTerms = new Map<string, string>([
			["a.md", "topic"],
			["b.md", "#group"],
			["c.md", "!team"],
			["d.md", ""],
			["e.md", "__epoch_no_topic__"]
		]);

		const indexer: any = {
			getIndexedPaths: () => Array.from(embeddingTerms.keys()),
			getFileEmbeddingTerm: (p: string) => embeddingTerms.get(p) ?? "",
			setFileEmbeddingTerm: (p: string, v: string) => {
				const prev = embeddingTerms.get(p) ?? "";
				embeddingTerms.set(p, v);
				return prev !== v;
			}
		};

		const plugin: any = {
			indexer,
			settings: {},
			ensureIndexLoaded: vi.fn(async () => {}),
			saveSettings: vi.fn(async () => {}),
			persist: vi.fn(async () => {}),
			refreshEpochViews: vi.fn(() => {}),
			app: {
				vault: { adapter }
			},
			termSimilarityFilePath: "epochgram-topics.json",
			termSimilarityLoaded: true,
			termSimilarityIndex: {
				model: "zeroshot",
				files: {
					"a.md": { term: "topic", score: 0.9, h: "h", vocabularySig: "sig", updatedAt: 1 }
				}
			}
		};

		await runReset(
			plugin,
			{
				settings: false,
				search: false,
				dataFiles: false,
				marks: false,
				reviewState: false,
				pinned: false,
				semantics: false,
				topics: true,
				trackedChanges: false,
				aiSummaries: false,
				epochs: false
			},
			{ keepLicense: true }
		);

		expect(embeddingTerms.get("a.md")).toBe("");
		expect(embeddingTerms.get("b.md")).toBe("");
		expect(embeddingTerms.get("c.md")).toBe("");
		expect(embeddingTerms.get("d.md")).toBe("");
		expect(embeddingTerms.get("e.md")).toBe("");

		expect(plugin.termSimilarityLoaded).toBe(true);
		expect(plugin.termSimilarityIndex?.files ?? {}).toEqual({});
		expect(adapter.write).toHaveBeenCalledTimes(1);

		const raw = fileStore.get("epochgram-topics.json") ?? "";
		expect(JSON.parse(raw)).toEqual({ model: DEFAULT_ZERO_SHOT_MODEL, files: {} });
	});
});
