export interface SimilarityMethods {
	getGraphRelatedPathsForFile(filePath: string): Promise<Set<string>>;
	getRelatedPathsForFile(filePath: string): Promise<Set<string>>;
	getRelatedScoredForFile(filePath: string): Promise<Array<{ path: string; score: number }>>;
}
