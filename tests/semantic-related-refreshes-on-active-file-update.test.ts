import { describe, expect, it, vi } from "vitest";

vi.mock("../src/plugin/pro-feature-state", async () => {
	const actual = await vi.importActual<any>("../src/plugin/pro-feature-state");
	return {
		...actual,
		hasSimilarityAccess: () => true
	};
});

vi.mock("../src/plugin/similarity/config", async () => {
	const actual = await vi.importActual<any>("../src/plugin/similarity/config");
	return {
		...actual,
		embeddingsSimilarityEnabled: () => false,
		isTopicSimilarityEnabled: () => false
	};
});

import { refreshSemanticRelatedForActiveFile } from "../src/ui/epoch-canvas/semantic";

describe("refreshSemanticRelatedForActiveFile reindex invalidation", () => {
	it("recomputes when active file indexed snapshot changes", async () => {
		let fileIndexData: any = {
			indexedMtimeMs: 100,
			indexedSize: 10,
			contentHash: "hash-a"
		};

		const getSemanticRelatedScoredForFile = vi.fn(async () => {
			return [{ path: "B.md", score: 0.9 }];
		});

		const canvas: any = {
			activeFilePath: "A.md",
			isEpochsViewActive: () => false,
			draw: vi.fn(),
			plugin: {
				settings: {
					similarityThreshold: 0.3,
					similarityUseLinks: true,
					similarityUseTags: true,
					similarityTitleJwThreshold: 0.9,
					similarityZeroShotMinScore: 0
				},
				indexer: {
					getFileIndexData: () => fileIndexData
				},
				getSemanticRelatedScoredForFile
			}
		};

		refreshSemanticRelatedForActiveFile(canvas, false);
		expect(getSemanticRelatedScoredForFile).toHaveBeenCalledTimes(1);

		// Simulate file reindexed after content update.
		fileIndexData = {
			...fileIndexData,
			indexedMtimeMs: 200,
			contentHash: "hash-b"
		};
		refreshSemanticRelatedForActiveFile(canvas, false);
		expect(getSemanticRelatedScoredForFile).toHaveBeenCalledTimes(2);

		// Unchanged snapshot: should stay stable and not recompute.
		refreshSemanticRelatedForActiveFile(canvas, false);
		expect(getSemanticRelatedScoredForFile).toHaveBeenCalledTimes(2);

		// Let any queued microtasks settle (avoid unhandled promise warnings).
		await Promise.resolve();
	});
});
