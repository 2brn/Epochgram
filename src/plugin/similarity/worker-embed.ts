import type { EpochPlugin } from "../../main";
import { debugLog, devConsoleLogOnce, safeStringify } from "./debug";
import { now } from "./time";
import { requestSimilarityWorker } from "./worker-rpc";
import { primeOrtWasmForWorker } from "./worker-ort";
import { clearEpochProgress } from "../progress";

type WorkerLoadResponse = { ok?: boolean } | null;

type WorkerEmbedPluginState = {
	similarityWorkerLastLoadError?: string | null;
	similarityWorkerLastLoadErrorAt?: number | null;
	similarityWorkerLastLoadErrorModelId?: string | null;
	similarityWorkerDisabled?: boolean;
};

export async function loadEmbeddingsModelViaWorker(plugin: EpochPlugin, modelId: string): Promise<boolean> {
	const normalized = String(modelId || "").trim();
	try {
		await primeOrtWasmForWorker(plugin);
		const resp = await requestSimilarityWorker(plugin, { type: "loadModel", modelId: normalized }) as WorkerLoadResponse;
		if (!!resp && resp.ok === true) {
			devConsoleLogOnce(plugin, `embeddings:${normalized}`, `[epoch] embeddings model loaded: ${normalized}`);
			try {
				const state = plugin as EpochPlugin & WorkerEmbedPluginState;
				state.similarityWorkerLastLoadError = null;
				state.similarityWorkerLastLoadErrorAt = null;
				state.similarityWorkerLastLoadErrorModelId = null;
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
			const state = plugin as EpochPlugin & WorkerEmbedPluginState & { similarityWorkerLastCreateError?: string | null };
			const createErr = String(state.similarityWorkerLastCreateError ?? "").trim();
			state.similarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			state.similarityWorkerLastLoadErrorAt = now();
			state.similarityWorkerLastLoadErrorModelId = normalized;
		} catch {
			// ignore
		}
		return false;
	} catch (error) {
		const msg = error instanceof Error ? error.message : typeof error === "string" && error ? error : "Worker loadModel failed";
		debugLog("embed:worker-loadModel-failed", { model: normalized, err: safeStringify(error, 2000) });
		try {
			clearEpochProgress(plugin, "semantic", 1500);
		} catch {
			// ignore
		}
		try {
			const state = plugin as EpochPlugin & WorkerEmbedPluginState;
			state.similarityWorkerLastLoadError = msg;
			state.similarityWorkerLastLoadErrorAt = now();
			state.similarityWorkerLastLoadErrorModelId = normalized;
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
	if (!resp || resp.ok !== true || resp.type !== "embedPooled") return null;
	return Array.isArray(resp.vector) ? resp.vector : [];
}

export async function embedPooledChunks(plugin: EpochPlugin, modelId: string, chunks: string[]): Promise<number[]> {
	try {
		const vec = await embedPooledViaWorker(plugin, modelId, chunks);
		if (vec) return vec;
	} catch (e) {
		debugLog("embed:worker-failed", { err: safeStringify(e, 1500) });
		try {
			const state = plugin as EpochPlugin & WorkerEmbedPluginState;
			state.similarityWorkerDisabled = true;
		} catch {
			// ignore
		}
	}
	throw new Error("Semantic vectors worker unavailable");
}
