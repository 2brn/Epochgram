import { describe, expect, it } from "vitest";
import { persistenceMethods } from "../src/plugin/persistence";
import { loadEpochSummariesFromDisk } from "../src/plugin/ai-summaries/epoch-summaries-store";

class MemoryAdapter {
	private files = new Map<string, string>();

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const v = this.files.get(path);
		if (v === undefined) throw new Error(`Missing file: ${path}`);
		return v;
	}

	async write(path: string, data: string): Promise<void> {
		this.files.set(path, String(data));
	}

	async mkdir(_path: string): Promise<void> {
		// no-op for in-memory adapter
	}

	async stat(path: string): Promise<{ mtime?: number; size?: number } | null> {
		const v = this.files.get(path);
		if (v === undefined) return null;
		return { mtime: Date.now(), size: v.length };
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}
}

describe("AI summaries persistence", () => {
	it("persists AI summaries to epochgram-summaries.json and strips them from epochgram-index.json", async () => {
		const adapter = new MemoryAdapter();

		const indexFilePath = "epochgram-index.json";
		const epochSummariesFilePath = "epochgram-summaries.json";

		const filePath = "Notes/a.md";
		const dateKey = "2025-01-01";
		const aiSummary = "HELLO AI";
		const aiHash = "hash123";

		const indexer: any = {
			files: {
				[filePath]: {
					cdate: {
						date: dateKey,
						file: filePath,
						source: "cdate",
						aiSummary,
						aiSummaryInputHash: aiHash
					}
				}
			},
			index: {
				[dateKey]: [
					{
						date: dateKey,
						file: filePath,
						source: "content",
						aiSummary,
						aiSummaryInputHash: aiHash
					}
				]
			},
			toJSON() {
				return {
					files: this.files,
					dates: this.index
				};
			}
		};

		const plugin: any = {
			app: { vault: { adapter } },
			indexer,
			indexFilePath,
			epochSummariesFilePath,
			pluginDirEnsured: true,
			pluginDirPath: ".",
			updateIndexFileStat: async () => {},
			savePluginData: async (_serialized?: any) => {}
		};

		Object.assign(plugin, persistenceMethods);
		// Override methods that would otherwise touch real plugin state.
		plugin.updateIndexFileStat = async () => {};
		plugin.savePluginData = async (_serialized?: any) => {};

		await plugin.persist({ skipEnsure: true });

		const rawIndex = await adapter.read(indexFilePath);
		expect(rawIndex).not.toContain("\"aiSummary\"");
		expect(rawIndex).not.toContain("\"aiSummaryInputHash\"");

		const rawSummaries = await adapter.read(epochSummariesFilePath);
		const parsed = JSON.parse(rawSummaries);
		expect(parsed?.aiSummaries?.[`${filePath}|${dateKey}|anchor`]).toEqual({ s: aiSummary, h: aiHash, v: 0 });
	});

	it("drops unsupported epoch buckets when loading epochgram-summaries.json", async () => {
		const adapter = new MemoryAdapter();
		const epochSummariesFilePath = "epochgram-summaries.json";
		const dateKey = "2025-01-01";

		await adapter.write(
			epochSummariesFilePath,
			JSON.stringify({
				epochsByDate: {
					[dateKey]: [
						{
							date: dateKey,
							file: "epoch://32days/2025-01-01-2025-02-01",
							source: "epoch",
							epochBucket: "32days",
							epochStart: "2025-01-01",
							epochEnd: "2025-02-01"
						},
						{
							date: dateKey,
							file: "epoch://month/2025-01-01-2025-01-31",
							source: "epoch",
							epochBucket: "month",
							epochStart: "2025-01-01",
							epochEnd: "2025-01-31"
						}
					]
				},
				aiSummaries: {}
			})
		);

		const plugin: any = {
			app: { vault: { adapter } },
			epochSummariesFilePath
		};

		const loaded = await loadEpochSummariesFromDisk(plugin);
		expect(Object.keys(loaded.epochsByDate)).toEqual([dateKey]);
		expect(loaded.epochsByDate[dateKey]?.length).toBe(1);
		expect((loaded.epochsByDate[dateKey]![0] as any).epochBucket).toBe("month");
	});
});
