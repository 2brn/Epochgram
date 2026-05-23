import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("../src/plugin/similarity/config", () => {
	return {
		isTopicSimilarityEnabled: vi.fn(() => true),
		isSimilarityEnabled: vi.fn(() => true)
	};
});

vi.mock("../src/plugin/similarity-term-store", () => {
	return {
		readTermStore: vi.fn(async () => ({ model: "zeroshot", files: {} }))
	};
});

vi.mock("../src/plugin/similarity/topic", () => {
	return {
		getEmbeddingTermForPath: vi.fn(() => ""),
		getTermVocabulary: vi.fn(() => ({ terms: ["foo"], sig: "v1" }))
	};
});

vi.mock("../src/plugin/similarity/worker-factory", () => {
	return {
		getSimilarityWorker: vi.fn(() => ({}))
	};
});

import { methodsTopic } from "../src/plugin/similarity/methods-topic";
import { getEmbeddingTermForPath } from "../src/plugin/similarity/topic";

describe("topics: missing classification sweep order", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Production code uses window.setTimeout; provide a minimal shim for node tests.
		(globalThis as any).window = globalThis as any;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("enqueues missing topic classifications newest-first", async () => {
		const queued: string[] = [];
		const files = [
			{ path: "a.md", stat: { mtime: 1 } },
			{ path: "c.md", stat: { mtime: 3 } },
			{ path: "b.md", stat: { mtime: 2 } }
		];

		const plugin: any = {
			hasProAccess: () => true,
			app: {
				vault: {
					getMarkdownFiles: () => files as any
				}
			},
			shouldIndexFile: () => true
		};
		withTrustedPro(plugin);

		plugin.queueTermSimilarityUpdate = (p: string) => {
			queued.push(p);
			if (!(plugin.termSimilarityPendingFiles instanceof Set)) {
				plugin.termSimilarityPendingFiles = new Set<string>();
			}
			plugin.termSimilarityPendingFiles.add(p);
		};

		methodsTopic.scheduleMissingTopicClassificationSweep.call(plugin, "topic-vocab");
		await vi.runAllTimersAsync();

		expect(queued).toEqual(["c.md", "b.md", "a.md"]);
	});

	it("skips files with explicit topics", async () => {
		const queued: string[] = [];
		const files = [
			{ path: "a.md", stat: { mtime: 1 } },
			{ path: "c.md", stat: { mtime: 3 } },
			{ path: "b.md", stat: { mtime: 2 } }
		];

		vi.mocked(getEmbeddingTermForPath).mockImplementation((_plugin: any, path: string) => {
			return path === "b.md" ? "topic" : "";
		});

		const plugin: any = {
			hasProAccess: () => true,
			app: {
				vault: {
					getMarkdownFiles: () => files as any
				}
			},
			shouldIndexFile: () => true
		};
		withTrustedPro(plugin);

		plugin.queueTermSimilarityUpdate = (p: string) => {
			queued.push(p);
			if (!(plugin.termSimilarityPendingFiles instanceof Set)) {
				plugin.termSimilarityPendingFiles = new Set<string>();
			}
			plugin.termSimilarityPendingFiles.add(p);
		};

		methodsTopic.scheduleMissingTopicClassificationSweep.call(plugin, "topic-vocab");
		await vi.runAllTimersAsync();

		expect(queued).toEqual(["c.md", "a.md"]);
	});
});
