import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("../src/plugin/similarity/config", () => {
	return {
		embeddingsSimilarityEnabled: vi.fn(() => true),
		getSimilarityModelId: vi.fn(() => "m"),
		isTopicSimilarityEnabled: vi.fn(() => false)
	};
});

vi.mock("../src/plugin/similarity/runtime", () => {
	return {
		embeddingsComputeEnabled: vi.fn(() => true)
	};
});

vi.mock("../src/plugin/similarity/store", () => {
	return {
		readStore: vi.fn(async () => ({ model: "m", dim: 1, files: {} }))
	};
});

vi.mock("../src/plugin/similarity/worker-embed", () => {
	return {
		loadEmbeddingsModelViaWorker: vi.fn(async () => true)
	};
});

import { methodsSettings } from "../src/plugin/similarity/methods-settings";

describe("similarity: settings enqueue order", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("queues semantic vector updates newest-first when enabling vectors", async () => {
		const queued: string[] = [];
		const files = [
			{ path: "old.md", extension: "md", stat: { mtime: 10 } },
			{ path: "new.md", extension: "md", stat: { mtime: 20 } },
			{ path: "mid.md", extension: "md", stat: { mtime: 15 } }
		];

		const plugin: any = {
			hasProAccess: () => true,
			settings: { similarityThreshold: 0.5, similarityZeroShotMinScore: 0.1 },
			app: {
				vault: {
					getFiles: () => files as any
				}
			},
			shouldIndexFile: () => true,
			queueVectorUpdate: (p: string) => queued.push(p)
		};
		withTrustedPro(plugin);

		await methodsSettings.onSimilaritySettingsChanged.call(plugin, "similarityThreshold");
		await vi.runAllTimersAsync();

		expect(queued).toEqual(["new.md", "mid.md", "old.md"]);
	});
});
