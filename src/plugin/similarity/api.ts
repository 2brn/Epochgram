import type { SimilarityMethods } from "./api-types";
import { methodsSettings } from "./methods-settings";
import { methodsRebuild } from "./methods-rebuild";
import { methodsVectors } from "./methods-vectors";
import { methodsTopic } from "./methods-topic";
import { methodsRelatedGraph } from "./methods-related-graph";
import { methodsRelatedSemantic } from "./methods-related-semantic";

export const similarityMethods: SimilarityMethods = {
	...methodsSettings,
	...methodsRebuild,
	...methodsVectors,
	...methodsTopic,
	...methodsRelatedGraph,
	...methodsRelatedSemantic
};
