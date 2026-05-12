export interface SimilarityMethods {
	onSimilaritySettingsChanged(
		key: "similarityThreshold" | "similarityZeroShotMinScore"
	): Promise<void>;
	scheduleMissingTopicClassificationSweep(reason?: string): void;
	rebuildSemanticVectorsWithProgress(): Promise<void>;
	rebuildTopicsWithProgress(): Promise<void>;
	rebuildRelationsWithProgress(): Promise<void>;
	queueVectorUpdate(filePath: string): void;
	removeVector(filePath: string): Promise<void>;
	renameVector(oldPath: string, newPath: string): Promise<void>;
	queueTermSimilarityUpdate(filePath: string): void;
	removeTermSimilarity(filePath: string): Promise<void>;
	renameTermSimilarity(oldPath: string, newPath: string): Promise<void>;
	getGraphRelatedPathsForFile(filePath: string): Promise<Set<string>>;
	getSemanticRelatedPathsForFile(filePath: string): Promise<Set<string>>;
	getSemanticRelatedScoredForFile(filePath: string): Promise<Array<{ path: string; score: number }>>;
	ensureSimilarityStoreLoaded(): Promise<void>;
	ensureTermSimilarityStoreLoaded(): Promise<void>;
	reloadVectorsFromDisk(): Promise<void>;
	reloadTermSimilaritiesFromDisk(): Promise<void>;
	renameTopicGroup(oldTopic: string, newTopic: string): Promise<void>;
}
