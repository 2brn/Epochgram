import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("../src/plugin/similarity/store", () => {
	return {
		readStore: vi.fn(async () => ({ model: "m", dim: 1, files: {} }))
	};
});

vi.mock("../src/plugin/similarity-term-store", () => {
	return {
		readTermStore: vi.fn(async () => ({ model: "zeroshot", files: {} }))
	};
});

import { runSimilarityStartupMaintenance } from "../src/plugin/similarity/startup-maintenance";

describe("similarity: huge vault startup maintenance", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("for >5000 notes, it still eventually enqueues vectors and topics for the whole vault", async () => {
		const queuedVectors: string[] = [];
		const queuedTopics: string[] = [];

		const mdFiles = Array.from({ length: 5001 }, (_, i) => ({ path: `f${i}.md`, stat: { mtime: i } }));

		const plugin: any = {
			proActive: true,
			hasProAccess() {
				return this.proActive === true;
			},
			settings: {
				similarityThreshold: 0.79,
				similarityZeroShotMinScore: 0.1
			},
			indexer: {
				getIndexedPaths() {
					return ["f0.md"];
				},
				getFileEmbeddingTerm() {
					return "foo";
				},
				getFileIndexData() {
					return { embeddingTerm: "" };
				}
			},
			app: {
				vault: {
					getFiles() {
						return mdFiles as any;
					}
				}
			},
			shouldIndexFile() {
				return true;
			},
			queueVectorUpdate(path: string) {
				queuedVectors.push(path);
			},
			queueTermSimilarityUpdate(path: string) {
				queuedTopics.push(path);
			}
		};
		withTrustedPro(plugin, "0.4.3-test", { preserveHasProAccess: true });

		const p = runSimilarityStartupMaintenance(plugin);
		await vi.runAllTimersAsync();
		await p;
		await vi.runAllTimersAsync();

		expect(plugin.__epochDidSimilarityStartupMaintenance).toBe(true);
		expect(queuedVectors.length).toBe(mdFiles.length);
		expect(queuedTopics.length).toBe(mdFiles.length);
		// Newest-first enqueue order (important for huge vaults where work starts mid-scan).
		expect(queuedVectors[0]).toBe("f5000.md");
		expect(queuedVectors[queuedVectors.length - 1]).toBe("f0.md");
		expect(queuedTopics[0]).toBe("f5000.md");
		expect(queuedTopics[queuedTopics.length - 1]).toBe("f0.md");
		expect(plugin.__epochHugeSimilarityBackfillFiles).toBeNull();
	});
});
