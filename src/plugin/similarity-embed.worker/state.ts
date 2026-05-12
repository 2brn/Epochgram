export type OrtWasmBlobUrls = Record<string, string>;

export const workerState = {
	embedder: null as any,
	embedderModelId: "",

	zeroShot: null as any,
	zeroShotModelId: "",

	transformers: null as any,
	ort: null as any,

	ortWasmBlobUrls: null as OrtWasmBlobUrls | null
};
