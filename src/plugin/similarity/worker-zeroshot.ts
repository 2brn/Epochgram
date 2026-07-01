import type { EpochPlugin } from "../../main";
import { debugLog, devConsoleLogOnce, safeStringify } from "./debug";
import { now } from "./time";
import { getZeroShotModelId } from "./config";
import { primeOrtWasmForWorker } from "./worker-ort";
import { requestSimilarityWorker } from "./worker-rpc";
import { clearEpochProgress } from "../progress";
import type { WorkerEmbedResponse } from "./types";

type ZeroShotPluginState = EpochPlugin & {
	termSimilarityWorkerLastLoadError?: string | null;
	termSimilarityWorkerLastLoadErrorAt?: number | null;
	similarityWorkerLastCreateError?: string | null;
};

function state(plugin: EpochPlugin): ZeroShotPluginState {
	return plugin;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return safeStringify(error, 500) || "Zero-shot load failed";
}

function asLoadZeroShotResponse(resp: WorkerEmbedResponse | null): Extract<WorkerEmbedResponse, { type: "loadZeroShot" }> | null {
	if (!resp || !resp.ok || resp.type !== "loadZeroShot") return null;
	return resp;
}

function asZeroShotScoreLabelsResponse(resp: WorkerEmbedResponse | null): Extract<WorkerEmbedResponse, { type: "zeroShotScoreLabels" }> | null {
	if (!resp || !resp.ok || resp.type !== "zeroShotScoreLabels") return null;
	return resp;
}

export async function loadZeroShotModelViaWorker(plugin: EpochPlugin): Promise<boolean> {
	try {
		await primeOrtWasmForWorker(plugin);
		const modelId = getZeroShotModelId(plugin);
		const resp = asLoadZeroShotResponse(await requestSimilarityWorker(plugin, { type: "loadZeroShot", modelId }));
		if (resp) {
			try {
				const pluginState = state(plugin);
				pluginState.termSimilarityWorkerLastLoadError = null;
				pluginState.termSimilarityWorkerLastLoadErrorAt = null;
			} catch {
				// ignore
			}
			devConsoleLogOnce(plugin, "zeroshot:model", "[epoch] zero-shot model loaded");
			return true;
		}
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}

		try {
			const pluginState = state(plugin);
			const createErr = String(pluginState.similarityWorkerLastCreateError ?? "").trim();
			pluginState.termSimilarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			pluginState.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	} catch (error: unknown) {
		debugLog("zeroshot:load-failed", { err: safeStringify(error, 1500) });
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}
		try {
			const pluginState = state(plugin);
			pluginState.termSimilarityWorkerLastLoadError = errorMessage(error);
			pluginState.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	}
}

export async function loadZeroShotModelViaWorkerWithId(plugin: EpochPlugin, modelIdOverride: string): Promise<boolean> {
	try {
		await primeOrtWasmForWorker(plugin);
		const modelId = String(modelIdOverride || "").trim() || getZeroShotModelId(plugin);
		const resp = asLoadZeroShotResponse(await requestSimilarityWorker(plugin, { type: "loadZeroShot", modelId }));
		if (resp) {
			try {
				const pluginState = state(plugin);
				pluginState.termSimilarityWorkerLastLoadError = null;
				pluginState.termSimilarityWorkerLastLoadErrorAt = null;
			} catch {
				// ignore
			}
			devConsoleLogOnce(plugin, "zeroshot:model", "[epoch] zero-shot model loaded");
			return true;
		}
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}

		try {
			const pluginState = state(plugin);
			const createErr = String(pluginState.similarityWorkerLastCreateError ?? "").trim();
			pluginState.termSimilarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			pluginState.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	} catch (error: unknown) {
		debugLog("zeroshot:load-failed", { err: safeStringify(error, 1500) });
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}
		try {
			const pluginState = state(plugin);
			pluginState.termSimilarityWorkerLastLoadError = errorMessage(error);
			pluginState.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	}
}

export async function zeroShotScoreLabelsViaWorker(
	plugin: EpochPlugin,
	labels: string[],
	sequence: string
): Promise<{ labels: string[]; scores: number[] } | null> {
	try {
		const resp = asZeroShotScoreLabelsResponse(await requestSimilarityWorker(plugin, { type: "zeroShotScoreLabels", labels, sequence }));
		if (!resp) return null;
		const outLabels = resp.labels.map((value) => String(value || "").trim()).filter(Boolean);
		const outScores = resp.scores.map((value) => {
			const n = Number(value);
			return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
		});
		return { labels: outLabels, scores: outScores };
	} catch (error: unknown) {
		debugLog("zeroshot:score-labels-failed", { err: safeStringify(error, 1500) });
		return null;
	}
}
