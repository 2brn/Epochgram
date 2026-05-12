import { describe, expect, it, vi } from "vitest";
import { readStore } from "../src/plugin/similarity/store";
import { DEFAULT_SIMILARITY_MODEL } from "../src/plugin/similarity/config";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("similarity: semantic threshold toggle preserves embeddings", () => {
	it("does not cache an empty store while disabled, so re-enable loads from disk", async () => {
		const fileStore = new Map<string, string>();
		const vectorsPath = "epoch-vectors.json";

		fileStore.set(
			vectorsPath,
			JSON.stringify({
				models: {
					[DEFAULT_SIMILARITY_MODEL]: {
						dim: 2,
						files: {
							"a.md": { v: [1, 2], h: "h", updatedAt: 1 }
						}
					}
				}
			})
		);

		const adapter = {
			exists: vi.fn(async (p: string) => fileStore.has(p)),
			read: vi.fn(async (p: string) => fileStore.get(p) ?? ""),
			write: vi.fn(async (p: string, data: string) => {
				fileStore.set(p, data);
			})
		};

		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 0 },
			vectorsFilePath: vectorsPath,
			app: { vault: { adapter } }
		};
		withTrustedPro(plugin);

		const disabled = await readStore(plugin);
		expect(disabled.model).toBe(DEFAULT_SIMILARITY_MODEL);
		expect(disabled.files).toEqual({});
		expect(adapter.read).toHaveBeenCalledTimes(0);
		// Crucial: do not mark vectors as loaded with an empty cache.
		expect(plugin.similarityVectorsLoaded).toBeUndefined();

		plugin.settings.similarityThreshold = 0.79;
		const enabled = await readStore(plugin);
		expect(Object.keys(enabled.files)).toEqual(["a.md"]);
		expect((enabled.files as any)["a.md"].h).toBe("h");
		expect(adapter.read).toHaveBeenCalledTimes(1);
	});
});
