import type { WorkerRequest, WorkerResponse } from "./types";
import { embedPooled, ensureEmbedder, ensureZeroShotClassifier, zeroShotScoreBatch, zeroShotScoreLabels } from "./models";
import { primeOrtWasmFromBuffers } from "./wasm";

declare const self: unknown;

type WorkerGlobalLike = {
	postMessage?: (msg: WorkerResponse) => void;
	onmessage?: (ev: MessageEvent) => void;
};

type PrimeWasmFileLike = { name?: string; data?: unknown };

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((x) => (typeof x === "string" ? x : "")).filter((x) => x.length > 0);
}

function toText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return String(error.stack || error.message || "Worker error");
	}
	if (typeof error === "string") return error;
	return "Worker error";
}

const workerCtx: WorkerGlobalLike = typeof self !== "undefined" ? (self as unknown as WorkerGlobalLike) : {};

function post(msg: WorkerResponse): void {
	if (typeof workerCtx?.postMessage === "function") {
		workerCtx.postMessage(msg);
	}
}

export function installSimilarityEmbedWorkerHandler(): void {
	workerCtx.onmessage = (ev: MessageEvent) => {
		void (async () => {
		const data = ev?.data as WorkerRequest;
		const dataObj = asRecord(data);
		const id = Number(dataObj.id ?? NaN);
		if (!Number.isFinite(id)) return;
		try {
			if (data.type === "ping") {
				post({ id, ok: true, type: "pong" });
				return;
			}
			if (data.type === "primeWasm") {
				const files = Array.isArray(dataObj.files) ? (dataObj.files as PrimeWasmFileLike[]) : [];
				const nonEmpty = files.filter((f) => {
					try {
						const ab = f?.data;
						return ab instanceof ArrayBuffer && ab.byteLength > 0;
					} catch {
						return false;
					}
				});
				const hasBase = nonEmpty.some((f) => String(f?.name || "").trim() === "ort-wasm.wasm");
				if (!hasBase) {
					throw new Error("primeWasm failed: missing or empty ort-wasm.wasm");
				}
				primeOrtWasmFromBuffers(nonEmpty as { name: string; data: ArrayBuffer }[]);
				post({ id, ok: true, type: "primeWasm" });
				return;
			}
			if (data.type === "loadModel") {
				const modelId = toText(dataObj.modelId).trim();
				await ensureEmbedder(modelId);
				post({ id, ok: true, type: "loadModel" });
				return;
			}
			if (data.type === "loadZeroShot") {
				const modelId = toText(dataObj.modelId).trim();
				await ensureZeroShotClassifier(modelId || undefined);
				post({ id, ok: true, type: "loadZeroShot" });
				return;
			}
			if (data.type === "embedPooled") {
				const modelId = toText(dataObj.modelId).trim();
				const chunks = toStringArray(dataObj.chunks);
				const vector = await embedPooled(modelId, chunks);
				post({ id, ok: true, type: "embedPooled", vector, dim: vector.length });
				return;
			}
			if (data.type === "zeroShotScoreBatch") {
				const label = toText(dataObj.label);
				const sequences = toStringArray(dataObj.sequences);
				const scores = await zeroShotScoreBatch(label, sequences);
				post({ id, ok: true, type: "zeroShotScoreBatch", scores });
				return;
			}
			if (data.type === "zeroShotScoreLabels") {
				const labels = toStringArray(dataObj.labels);
				const sequence = toText(dataObj.sequence);
				const res = await zeroShotScoreLabels(labels, sequence);
				post({ id, ok: true, type: "zeroShotScoreLabels", labels: res.labels, scores: res.scores });
				return;
			}
			post({ id, ok: false, type: "error", error: "Unknown message type" });
		} catch (e: unknown) {
			post({ id, ok: false, type: "error", error: toErrorMessage(e) });
		}
		})();
	};
}
