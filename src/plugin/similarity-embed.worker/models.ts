import { workerState } from "./state";
import { withProcessMasked } from "./process-mask";
import { assertOrtAvailable, getOrt, getTransformers } from "./runtime";
import { getOrtWasmCdnBase, getWorkerLocationDebug } from "./wasm";
import { coerceVector, meanPool } from "./vectors";

declare const self: unknown;

type WorkerGlobalLike = {
	postMessage?: (msg: unknown) => void;
	navigator?: { gpu?: unknown };
	ort?: unknown;
	onnxruntime?: unknown;
};

type ProgressInput = {
	progress?: number;
	loaded?: number;
	total?: number;
	name?: string;
};

type EmbedderLike = {
	model?: { config?: Record<string, unknown> };
	tokenizer?: Record<string, unknown>;
};

type OrtLike = {
	env?: { wasm?: Record<string, unknown> };
	InferenceSession?: unknown;
	Tensor?: unknown;
};

type TransformersEnvLike = {
	useFS?: boolean;
	useFSCache?: boolean;
	allowLocalModels?: boolean;
	useBrowserCache?: boolean;
	allowRemoteModels?: boolean;
	backends?: { onnx?: { wasm?: Record<string, unknown> } };
};

type WorkerRuntimeLike = Record<string, unknown>;
type PipelineFn = (task: string, modelId: string, options?: Record<string, unknown>) => Promise<WorkerRuntimeLike>;
type ZeroShotFn = (sequence: string, labels: string[], options?: Record<string, unknown>) => Promise<{ labels?: unknown; scores?: unknown }>;
type EmbedFn = (text: string, options?: Record<string, unknown>) => Promise<unknown>;

const workerGlobal = self as WorkerGlobalLike;

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
		workerGlobal.postMessage?.(msg);
	} catch {
		// ignore
	}
}

function makeProgressCallback(kind: "semantic" | "topics", modelId: string): (p: unknown) => void {
	let lastPct = -1;
	let lastAt = 0;
	return (p: unknown) => {
		try {
			const prog = (p ?? {}) as ProgressInput;
			const now = Date.now();
			let pct = Number.NaN;
			const progress = Number(prog.progress);
			if (Number.isFinite(progress)) {
				pct = progress <= 1 ? progress * 100 : progress;
			}
			const loaded = Number(prog.loaded);
			const total = Number(prog.total);
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
				file: typeof prog.name === "string" ? prog.name : undefined,
				pct: nextPct
			});
		} catch {
			// ignore
		}
	};
}

function getEmbedderMaxLength(embedderInst: unknown): number {
	try {
		const inst = (embedderInst ?? {}) as EmbedderLike;
		const cfg = inst.model?.config;
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
		const tok = ((embedderInst ?? {}) as EmbedderLike).tokenizer;
		const v = tok?.model_max_length ?? tok?.modelMaxLength ?? tok?.max_length ?? tok?.maxLength ?? tok?.maxLen;
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) return Math.max(64, Math.min(2048, Math.floor(n)));
	} catch {
		// ignore
	}
	return 512;
}

function forceTokenizerMaxLength(embedderInst: unknown): void {
	try {
		const maxLen = getEmbedderMaxLength(embedderInst);
		const tok = ((embedderInst ?? {}) as EmbedderLike).tokenizer;
		if (!tok) return;
		tok.model_max_length = maxLen;
		tok.max_length = maxLen;
		tok.maxLen = maxLen;
	} catch {
		// ignore
	}
}

function configureOrtAndTransformersWasm({ ort, env }: { ort: unknown; env: unknown }): void {
	const hasBlobOverride = !!(workerState.ortWasmBlobUrls && Object.keys(workerState.ortWasmBlobUrls).length > 0);
	const loc = getWorkerLocationDebug();
	void loc;

	const getPaths = async (): Promise<unknown> => {
		return hasBlobOverride
			? (workerState.ortWasmBlobUrls)
			: getOrtWasmCdnBase();
	};

	// Configure async (needs possible preflight).
	const configureAsync = async () => {
		const wasmPaths = await getPaths();
		try {
			const ortEnv = (ort as OrtLike)?.env;
			if (ortEnv?.wasm) {
				ortEnv.wasm.numThreads = 1;
				ortEnv.wasm.simd = false;
				ortEnv.wasm.proxy = false;
				ortEnv.wasm.wasmPaths = wasmPaths;
			}
		} catch {
			// ignore
		}

		const onnxEnv = (env as TransformersEnvLike)?.backends?.onnx;
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
	(workerState as unknown as { __configureOrtPromise?: Promise<void> }).__configureOrtPromise = configureAsync();
}

async function ensureOrtConfigured(): Promise<void> {
	const p = (workerState as unknown as { __configureOrtPromise?: Promise<void> }).__configureOrtPromise;
	if (p) await p;
}

function supportsWebGpu(): boolean {
	return false;
	try {
		return !!(workerGlobal?.navigator?.gpu);
	} catch {
		return false;
	}
}

async function createPipelineWithDeviceFallback(
	pipeline: PipelineFn,
	task: string,
	modelId: string,
	kind: "semantic" | "topics",
	options: Record<string, unknown>
): Promise<WorkerRuntimeLike> {
	const devices = supportsWebGpu() ? ["webgpu", "wasm"] : ["wasm"];
	let lastError: unknown = null;
	for (const device of devices) {
		try {
			return await pipeline(task, modelId, { ...(options || {}), device });
		} catch (e) {
			lastError = e;
		}
	}
	if (lastError instanceof Error) throw lastError;
	const message = typeof lastError === "string"
		? lastError
		: (() => {
			try {
				return JSON.stringify(lastError);
			} catch {
				return "Failed to create pipeline backend";
			}
		})();
	throw new Error(message || "Failed to create pipeline backend");
}

export async function ensureEmbedder(modelId: string): Promise<unknown> {
	const normalized = String(modelId || "").trim();
	if (workerState.embedder && workerState.embedderModelId === normalized) return workerState.embedder;

	return await withProcessMasked(async () => {
		const tf = await getTransformers();
		const env = tf?.env as TransformersEnvLike | undefined;
		const pipeline = tf?.pipeline as PipelineFn;
		if (!env || typeof pipeline !== "function") {
			throw new Error("@huggingface/transformers failed to load in worker");
		}

		const ort = (await getOrt()) as OrtLike;
		try {
			void ort.InferenceSession;
			void ort.Tensor;
		} catch {
			// ignore
		}

		try {
			workerGlobal.ort = ort;
			workerGlobal.onnxruntime = ort;
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

export async function ensureZeroShotClassifier(modelId?: string): Promise<unknown> {
	if (!modelId) {
		if (workerState.zeroShot) return workerState.zeroShot;
	}
	const normalized = String(modelId || DEFAULT_ZERO_SHOT_MODEL_ID).trim() || DEFAULT_ZERO_SHOT_MODEL_ID;
	if (workerState.zeroShot && workerState.zeroShotModelId === normalized) return workerState.zeroShot;

	return await withProcessMasked(async () => {
		const tf = await getTransformers();
		const env = tf?.env as TransformersEnvLike | undefined;
		const pipeline = tf?.pipeline as PipelineFn;
		if (!env || typeof pipeline !== "function") {
			throw new Error("@huggingface/transformers failed to load in worker");
		}

		const ort = (await getOrt()) as OrtLike;
		try {
			void ort.InferenceSession;
			void ort.Tensor;
		} catch {
			// ignore
		}
		try {
			workerGlobal.ort = ort;
			workerGlobal.onnxruntime = ort;
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
	const clf = (await ensureZeroShotClassifier()) as ZeroShotFn;
	const lab = String(label || "").trim();
	if (!lab) return 0;
	const seq = String(sequence || "");
	if (!seq) return 0;
	const out = await clf(seq, [lab], {
		hypothesis_template: "This text is about {}.",
		multi_label: true
	});
	const scores: unknown = out?.scores;
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
	const clf = (await ensureZeroShotClassifier()) as ZeroShotFn;
	const seq = String(sequence || "");
	if (!seq) return { labels: [], scores: [] };
	const labs = (labels || []).map(l => String(l || "").trim()).filter(Boolean);
	if (labs.length === 0) return { labels: [], scores: [] };
	const out = await clf(seq, labs, {
		hypothesis_template: "This text is about {}.",
		multi_label: true
	});
	const outLabels: unknown = out?.labels;
	const outScores: unknown = out?.scores;
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
	const emb = (await ensureEmbedder(modelId)) as EmbedFn;
	forceTokenizerMaxLength(emb);
	const out: unknown = await emb(text, { pooling: "mean", normalize: true });
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

