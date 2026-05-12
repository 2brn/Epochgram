import { workerState } from "./state";
import { withProcessMasked } from "./process-mask";
import { assertOrtAvailable, getOrt, getTransformers } from "./runtime";
import { getOrtWasmCdnBase, getWorkerLocationDebug } from "./wasm";
import { coerceVector, meanPool } from "./vectors";

// Zero-shot classification (term similarity)
const DEFAULT_ZERO_SHOT_MODEL_ID = "MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33";

type WorkerProgressMsg = {
	type: "progress";
	kind: "semantic" | "topics";
	status?: string;
	stage?: string;
	modelId?: string;
	file?: string;
	pct?: number;
	message?: string;
};

function postProgress(msg: WorkerProgressMsg): void {
	try {
		(self as any).postMessage(msg);
	} catch {
		// ignore
	}
}

function makeProgressCallback(kind: "semantic" | "topics", modelId: string): (p: any) => void {
	let lastPct = -1;
	let lastAt = 0;
	return (p: any) => {
		try {
			const now = Date.now();
			let pct = Number.NaN;
			const progress = Number(p?.progress);
			if (Number.isFinite(progress)) {
				pct = progress <= 1 ? progress * 100 : progress;
			}
			const loaded = Number(p?.loaded);
			const total = Number(p?.total);
			if (!Number.isFinite(pct) && Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
				pct = (loaded / total) * 100;
			}
			const nextPct = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.floor(pct))) : -1;
			if (nextPct < 0) return;
			if (nextPct === lastPct && now - lastAt < 500) return;
			if (lastPct >= 0 && Math.abs(nextPct - lastPct) < 1 && now - lastAt < 700) return;
			lastPct = nextPct;
			lastAt = now;
			postProgress({
				type: "progress",
				kind,
				stage: "download",
				status: "progress",
				modelId,
				file: typeof p?.name === "string" ? p.name : undefined,
				pct: nextPct
			});
		} catch {
			// ignore
		}
	};
}

function getEmbedderMaxLength(embedderInst: any): number {
	try {
		const cfg = embedderInst?.model?.config;
		const candidates = [
			cfg?.max_position_embeddings,
			cfg?.max_positions,
			cfg?.n_positions,
			cfg?.max_seq_len,
			cfg?.max_sequence_length
		];
		for (const v of candidates) {
			const n = Number(v);
			if (Number.isFinite(n) && n > 0) return Math.max(64, Math.min(2048, Math.floor(n)));
		}
	} catch {
		// ignore
	}
	try {
		const tok = embedderInst?.tokenizer;
		const v = tok?.model_max_length ?? tok?.modelMaxLength ?? tok?.max_length ?? tok?.maxLength ?? tok?.maxLen;
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) return Math.max(64, Math.min(2048, Math.floor(n)));
	} catch {
		// ignore
	}
	return 512;
}

function forceTokenizerMaxLength(embedderInst: any): void {
	try {
		const maxLen = getEmbedderMaxLength(embedderInst);
		const tok: any = embedderInst?.tokenizer;
		if (!tok) return;
		tok.model_max_length = maxLen;
		tok.max_length = maxLen;
		tok.maxLen = maxLen;
	} catch {
		// ignore
	}
}

function configureOrtAndTransformersWasm({ ort, env }: { ort: any; env: any }): void {
	const hasBlobOverride = !!(workerState.ortWasmBlobUrls && Object.keys(workerState.ortWasmBlobUrls).length > 0);
	const loc = getWorkerLocationDebug();
	void loc;

	const getPaths = async (): Promise<any> => {
		return hasBlobOverride
			? (workerState.ortWasmBlobUrls as any)
			: getOrtWasmCdnBase();
	};

	// Configure async (needs possible preflight).
	const configureAsync = async () => {
		const wasmPaths = await getPaths();
		try {
			const ortEnv: any = (ort as any)?.env;
			if (ortEnv?.wasm) {
				ortEnv.wasm.numThreads = 1;
				ortEnv.wasm.simd = false;
				ortEnv.wasm.proxy = false;
				ortEnv.wasm.wasmPaths = wasmPaths;
			}
		} catch {
			// ignore
		}

		const onnxEnv: any = (env as any)?.backends?.onnx;
		if (onnxEnv?.wasm) {
			try {
				onnxEnv.wasm.numThreads = 1;
			} catch {
				// ignore
			}
			try {
				onnxEnv.wasm.simd = false;
			} catch {
				// ignore
			}
			try {
				onnxEnv.wasm.proxy = false;
			} catch {
				// ignore
			}
			onnxEnv.wasm.wasmPaths = wasmPaths;
		}
	};

	// Fire-and-wait: callers await this.
	(workerState as any).__configureOrtPromise = configureAsync();
}

async function ensureOrtConfigured(): Promise<void> {
	const p: Promise<void> | undefined = (workerState as any).__configureOrtPromise;
	if (p) await p;
}

function supportsWebGpu(): boolean {
	return false;
	try {
		return !!((globalThis as any)?.navigator?.gpu);
	} catch {
		return false;
	}
}

async function createPipelineWithDeviceFallback(
	pipeline: any,
	task: string,
	modelId: string,
	kind: "semantic" | "topics",
	options: any
): Promise<any> {
	const devices = supportsWebGpu() ? ["webgpu", "wasm"] : ["wasm"];
	let lastError: any = null;
	for (const device of devices) {
		try {
			return await pipeline(task, modelId, { ...(options || {}), device } as any);
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError ?? new Error("Failed to create pipeline backend");
}

export async function ensureEmbedder(modelId: string): Promise<any> {
	const normalized = String(modelId || "").trim();
	if (workerState.embedder && workerState.embedderModelId === normalized) return workerState.embedder;

	return await withProcessMasked(async () => {
		const tf = await getTransformers();
		const env: any = tf?.env;
		const pipeline: any = tf?.pipeline;
		if (!env || typeof pipeline !== "function") {
			throw new Error("@huggingface/transformers failed to load in worker");
		}

		const ort: any = await getOrt();
		try {
			void (ort as any).InferenceSession;
			void (ort as any).Tensor;
		} catch {
			// ignore
		}

		try {
			(globalThis as any).ort = ort as any;
			(globalThis as any).onnxruntime = ort as any;
		} catch {
			// ignore
		}
		assertOrtAvailable(ort);

		env.useFS = false;
		env.useFSCache = false;
		env.allowLocalModels = true;
		env.useBrowserCache = true;
		env.allowRemoteModels = true;

		configureOrtAndTransformersWasm({ ort, env });
		await ensureOrtConfigured();
		postProgress({ type: "progress", kind: "semantic", status: "start", stage: "download", modelId: normalized });

		const embedder = await createPipelineWithDeviceFallback(
			pipeline,
			"feature-extraction",
			normalized,
			"semantic",
			{
				progress_callback: makeProgressCallback("semantic", normalized),
				quantized: false
			}
		);
		postProgress({ type: "progress", kind: "semantic", status: "done", stage: "download", modelId: normalized, pct: 100 });

		workerState.embedder = embedder;
		workerState.embedderModelId = normalized;
		forceTokenizerMaxLength(embedder);
		return embedder;
	});
}

export async function ensureZeroShotClassifier(modelId?: string): Promise<any> {
	if (!modelId) {
		if (workerState.zeroShot) return workerState.zeroShot;
	}
	const normalized = String(modelId || DEFAULT_ZERO_SHOT_MODEL_ID).trim() || DEFAULT_ZERO_SHOT_MODEL_ID;
	if (workerState.zeroShot && workerState.zeroShotModelId === normalized) return workerState.zeroShot;

	return await withProcessMasked(async () => {
		const tf = await getTransformers();
		const env: any = tf?.env;
		type PipelineFn = (task: string, model: string, options?: any) => Promise<any>;
		const pipeline: PipelineFn = tf?.pipeline as any;
		if (!env || typeof pipeline !== "function") {
			throw new Error("@huggingface/transformers failed to load in worker");
		}

		const ort: any = await getOrt();
		try {
			void (ort as any).InferenceSession;
			void (ort as any).Tensor;
		} catch {
			// ignore
		}
		try {
			(globalThis as any).ort = ort as any;
			(globalThis as any).onnxruntime = ort as any;
		} catch {
			// ignore
		}
		assertOrtAvailable(ort);

		env.useFS = false;
		env.useFSCache = false;
		env.allowLocalModels = true;
		env.useBrowserCache = true;
		env.allowRemoteModels = true;

		configureOrtAndTransformersWasm({ ort, env });
		await ensureOrtConfigured();
		postProgress({ type: "progress", kind: "topics", status: "start", stage: "download", modelId: normalized });

		const zeroShot = await createPipelineWithDeviceFallback(
			pipeline,
			"zero-shot-classification",
			normalized,
			"topics",
			{
				progress_callback: makeProgressCallback("topics", normalized),
				quantized: true
			}
		);
		postProgress({ type: "progress", kind: "topics", status: "done", stage: "download", modelId: normalized, pct: 100 });
		workerState.zeroShot = zeroShot;
		workerState.zeroShotModelId = normalized;
		return zeroShot;
	});
}

export async function zeroShotScoreSingle(label: string, sequence: string): Promise<number> {
	const clf = await ensureZeroShotClassifier();
	const lab = String(label || "").trim();
	if (!lab) return 0;
	const seq = String(sequence || "");
	if (!seq) return 0;
	const out: any = await clf(seq, [lab], {
		hypothesis_template: "This text is about {}.",
		multi_label: true
	});
	const scores: any = out?.scores;
	const v = Array.isArray(scores) ? Number(scores[0]) : Number.NaN;
	return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export async function zeroShotScoreBatch(label: string, sequences: string[]): Promise<number[]> {
	const out: number[] = [];
	for (const s of sequences || []) {
		out.push(await zeroShotScoreSingle(label, s));
	}
	return out;
}

export async function zeroShotScoreLabels(
	labels: string[],
	sequence: string
): Promise<{ labels: string[]; scores: number[] }> {
	const clf = await ensureZeroShotClassifier();
	const seq = String(sequence || "");
	if (!seq) return { labels: [], scores: [] };
	const labs = (labels || []).map(l => String(l || "").trim()).filter(Boolean);
	if (labs.length === 0) return { labels: [], scores: [] };
	const out: any = await clf(seq, labs, {
		hypothesis_template: "This text is about {}.",
		multi_label: true
	});
	const outLabels: any = out?.labels;
	const outScores: any = out?.scores;
	const map = new Map<string, number>();
	if (Array.isArray(outLabels) && Array.isArray(outScores)) {
		for (let i = 0; i < outLabels.length; i++) {
			const l = String(outLabels[i] ?? "").trim();
			const s = Number(outScores[i]);
			if (!l) continue;
			map.set(l, Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0);
		}
	}
	const scores = labs.map(l => map.get(l) ?? 0);
	return { labels: labs, scores };
}

async function embedChunk(modelId: string, text: string): Promise<number[]> {
	const emb = await ensureEmbedder(modelId);
	forceTokenizerMaxLength(emb);
	const out: any = await emb(text, { pooling: "mean", normalize: true });
	return coerceVector(out);
}

export async function embedPooled(modelId: string, chunks: string[]): Promise<number[]> {
	const vecs: number[][] = [];
	for (const c of chunks) {
		const t = String(c || "");
		if (!t) continue;
		vecs.push(await embedChunk(modelId, t));
	}
	return meanPool(vecs);
}

