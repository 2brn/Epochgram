import { methodsRelatedGraph } from "./methods-related-graph";
import { methodsRelated } from "./methods-related";
import type { SimilarityMethods } from "./api-types";
export const similarityMethods: SimilarityMethods = { ...methodsRelatedGraph, ...methodsRelated };
