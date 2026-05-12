import { describe, it, expect } from "vitest";

import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL, getSimilarityModelId, getZeroShotModelId } from "../src/plugin/similarity/config";

describe("Similarity model ID settings", () => {
	it("uses defaults when unset", () => {
		const plugin: any = { settings: {} };
		expect(getSimilarityModelId(plugin)).toBe(DEFAULT_SIMILARITY_MODEL);
		expect(getZeroShotModelId(plugin)).toBe(DEFAULT_ZERO_SHOT_MODEL);
	});

	it("uses trimmed overrides when set", () => {
		const plugin: any = {
			settings: {
				similarityEmbeddingModelId: "  acme/embeddings-v1  ",
				similarityZeroShotModelId: "  acme/zeroshot-v1  "
			}
		};
		expect(getSimilarityModelId(plugin)).toBe("acme/embeddings-v1");
		expect(getZeroShotModelId(plugin)).toBe("acme/zeroshot-v1");
	});
});
