export type OrtWasmBlobUrls = Record<string, string>;

type WorkerRuntimeLike = Record<string, unknown>;

export const workerState = {
	embedder: null as WorkerRuntimeLike | null,
	embedderModelId: "",

	zeroShot: null as WorkerRuntimeLike | null,
	zeroShotModelId: "",

	transformers: null as WorkerRuntimeLike | null,
	ort: null as WorkerRuntimeLike | null,

	ortWasmBlobUrls: null as OrtWasmBlobUrls | null
};
