import type { EpochPlugin } from "../../main";
import { debugLog, devConsoleLogOnce, safeStringify } from "./debug";
import { now } from "./time";
import { requestSimilarityWorker } from "./worker-rpc";
import { primeOrtWasmForWorker } from "./worker-ort";
import { clearEpochProgress } from "../progress";

export async function loadEmbeddingsModelViaWorker(plugin: EpochPlugin, modelId: string): Promise<boolean> {
	const normalized = String(modelId || "").trim();
	try {
		await primeOrtWasmForWorker(plugin);
		const resp = await requestSimilarityWorker(plugin, { type: "loadModel", modelId: normalized } as any);
		if (!!resp && (resp as any).ok === true) {
			devConsoleLogOnce(plugin, `embeddings:${normalized}`, `[epoch] embeddings model loaded: ${normalized}`);
			try {
				const anyPlugin: any = plugin as any;
				anyPlugin.similarityWorkerLastLoadError = null;
				anyPlugin.similarityWorkerLastLoadErrorAt = null;
				anyPlugin.similarityWorkerLastLoadErrorModelId = null;
			} catch {
				// ignore
			}
			return true;
		}
		try {
			clearEpochProgress(plugin, "semantic", 1500);
		} catch {
			// ignore
		}
		try {
			const anyPlugin: any = plugin as any;
			const createErr = String(anyPlugin?.similarityWorkerLastCreateError ?? "").trim();
			anyPlugin.similarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			anyPlugin.similarityWorkerLastLoadErrorAt = now();
			anyPlugin.similarityWorkerLastLoadErrorModelId = normalized;
		} catch {
			// ignore
		}
		return false;
	} catch (e: any) {
		const msg = String(e?.message || e || "Worker loadModel failed");
		debugLog("embed:worker-loadModel-failed", { model: normalized, err: safeStringify(e, 2000) });
		try {
			clearEpochProgress(plugin, "semantic", 1500);
		} catch {
			// ignore
		}
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.similarityWorkerLastLoadError = msg;
			anyPlugin.similarityWorkerLastLoadErrorAt = now();
			anyPlugin.similarityWorkerLastLoadErrorModelId = normalized;
		} catch {
			// ignore
		}
		return false;
	}
}

async function embedPooledViaWorker(plugin: EpochPlugin, modelId: string, chunks: string[]): Promise<number[] | null> {
	const resp = await requestSimilarityWorker(plugin, {
		type: "embedPooled",
		modelId: String(modelId || "").trim(),
		chunks: Array.isArray(chunks) ? chunks.map((c) => String(c || "")).filter(Boolean) : []
	});
	if (!resp || (resp as any).ok !== true || (resp as any).type !== "embedPooled") return null;
	return Array.isArray((resp as any).vector) ? (resp as any).vector : [];
}

export async function embedPooledChunks(plugin: EpochPlugin, modelId: string, chunks: string[]): Promise<number[]> {
	try {
		const vec = await embedPooledViaWorker(plugin, modelId, chunks);
		if (vec) return vec;
	} catch (e) {
		debugLog("embed:worker-failed", { err: safeStringify(e, 1500) });
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.similarityWorkerDisabled = true;
		} catch {
			// ignore
		}
	}
	throw new Error("Semantic vectors worker unavailable");
}
