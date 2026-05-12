export type WorkerRequest =
	| { id: number; type: "primeWasm"; files: Array<{ name: string; data: ArrayBuffer }> }
	| { id: number; type: "embedPooled"; modelId: string; chunks: string[] }
	| { id: number; type: "loadModel"; modelId: string }
	| { id: number; type: "loadZeroShot"; modelId?: string }
	| { id: number; type: "zeroShotScoreBatch"; label: string; sequences: string[] }
	| { id: number; type: "zeroShotScoreLabels"; labels: string[]; sequence: string }
	| { id: number; type: "ping" };

export type WorkerResponse =
	| { id: number; ok: true; type: "pong" }
	| { id: number; ok: true; type: "primeWasm" }
	| { id: number; ok: true; type: "loadModel" }
	| { id: number; ok: true; type: "loadZeroShot" }
	| { id: number; ok: true; type: "embedPooled"; vector: number[]; dim: number }
	| { id: number; ok: true; type: "zeroShotScoreBatch"; scores: number[] }
	| { id: number; ok: true; type: "zeroShotScoreLabels"; scores: number[]; labels: string[] }
	| { id: number; ok: false; type: "error"; error: string };
