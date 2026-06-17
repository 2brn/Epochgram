import type { WorkerRequest, WorkerResponse } from "./types";
import { embedPooled, ensureEmbedder, ensureZeroShotClassifier, zeroShotScoreBatch, zeroShotScoreLabels } from "./models";
import { primeOrtWasmFromBuffers } from "./wasm";

const workerCtx: any = typeof self !== "undefined" ? (self as any) : {};

function post(msg: WorkerResponse): void {
	if (typeof workerCtx?.postMessage === "function") {
		workerCtx.postMessage(msg);
	}
}

export function installSimilarityEmbedWorkerHandler(): void {
	workerCtx.onmessage = async (ev: MessageEvent) => {
		const data: WorkerRequest = ev?.data as any;
		const id = Number((data as any)?.id);
		if (!Number.isFinite(id)) return;
		try {
			if (data.type === "ping") {
				post({ id, ok: true, type: "pong" });
				return;
			}
			if (data.type === "primeWasm") {
				const files = Array.isArray((data as any).files) ? (data as any).files : [];
				const nonEmpty = files.filter((f: any) => {
					try {
						const ab = f?.data;
						return ab instanceof ArrayBuffer && ab.byteLength > 0;
					} catch {
						return false;
					}
				});
				const hasBase = nonEmpty.some((f: any) => String(f?.name || "").trim() === "ort-wasm.wasm");
				if (!hasBase) {
					throw new Error("primeWasm failed: missing or empty ort-wasm.wasm");
				}
				primeOrtWasmFromBuffers(nonEmpty as any);
				post({ id, ok: true, type: "primeWasm" });
				return;
			}
			if (data.type === "loadModel") {
				const modelId = String((data as any).modelId || "").trim();
				await ensureEmbedder(modelId);
				post({ id, ok: true, type: "loadModel" });
				return;
			}
			if (data.type === "loadZeroShot") {
				const modelId = String((data as any).modelId || "").trim();
				await ensureZeroShotClassifier(modelId || undefined);
				post({ id, ok: true, type: "loadZeroShot" });
				return;
			}
			if (data.type === "embedPooled") {
				const modelId = String((data as any).modelId || "").trim();
				const chunks = Array.isArray((data as any).chunks)
					? (data as any).chunks.map((x: any) => String(x || ""))
					: [];
				const vector = await embedPooled(modelId, chunks);
				post({ id, ok: true, type: "embedPooled", vector, dim: vector.length });
				return;
			}
			if (data.type === "zeroShotScoreBatch") {
				const label = String((data as any).label || "");
				const sequences = Array.isArray((data as any).sequences)
					? (data as any).sequences.map((x: any) => String(x || ""))
					: [];
				const scores = await zeroShotScoreBatch(label, sequences);
				post({ id, ok: true, type: "zeroShotScoreBatch", scores });
				return;
			}
			if (data.type === "zeroShotScoreLabels") {
				const labels = Array.isArray((data as any).labels) ? (data as any).labels.map((x: any) => String(x || "")) : [];
				const sequence = String((data as any).sequence || "");
				const res = await zeroShotScoreLabels(labels, sequence);
				post({ id, ok: true, type: "zeroShotScoreLabels", labels: res.labels, scores: res.scores });
				return;
			}
			post({ id, ok: false, type: "error", error: "Unknown message type" });
		} catch (e: any) {
			post({ id, ok: false, type: "error", error: String(e?.stack || e?.message || e || "Worker error") });
		}
	};
}
