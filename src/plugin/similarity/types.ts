export type SimilarityFileVector = {
	v: number[];
	h: string;
	updatedAt: number;
};

export type WorkerEmbedResponse =
	| { id: number; ok: true; type: "pong" }
	| { id: number; ok: true; type: "primeWasm" }
	| { id: number; ok: true; type: "loadModel" }
	| { id: number; ok: true; type: "loadZeroShot" }
	| { id: number; ok: true; type: "embedPooled"; vector: number[]; dim: number }
	| { id: number; ok: true; type: "zeroShotScoreBatch"; scores: number[] }
	| { id: number; ok: true; type: "zeroShotScoreLabels"; labels: string[]; scores: number[] }
	| { id: number; ok: false; type: "error"; error: string };

export type SimilarityStore = {
	model: string;
	dim: number;
	files: Record<string, SimilarityFileVector>;
};
