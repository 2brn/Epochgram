import type { EpochPlugin } from "../../main";
import { debugLog, devConsoleLogOnce, safeStringify } from "./debug";
import { now } from "./time";
import { getZeroShotModelId } from "./config";
import { primeOrtWasmForWorker } from "./worker-ort";
import { requestSimilarityWorker } from "./worker-rpc";
import { clearEpochProgress } from "../progress";

export async function loadZeroShotModelViaWorker(plugin: EpochPlugin): Promise<boolean> {
	try {
		await primeOrtWasmForWorker(plugin);
		const modelId = getZeroShotModelId(plugin);
		const resp = await requestSimilarityWorker(plugin, { type: "loadZeroShot", modelId } as any);
		if (!!resp && (resp as any).ok === true) {
			try {
				const anyPlugin: any = plugin as any;
				anyPlugin.termSimilarityWorkerLastLoadError = null;
				anyPlugin.termSimilarityWorkerLastLoadErrorAt = null;
			} catch {
				// ignore
			}
			devConsoleLogOnce(plugin, "zeroshot:model", "[epoch] zero-shot model loaded");
			return (resp as any).type === "loadZeroShot";
		}
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}

		try {
			const anyPlugin: any = plugin as any;
			const createErr = String(anyPlugin?.similarityWorkerLastCreateError ?? "").trim();
			anyPlugin.termSimilarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			anyPlugin.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	} catch (e: any) {
		debugLog("zeroshot:load-failed", { err: safeStringify(e, 1500) });
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.termSimilarityWorkerLastLoadError = String(e?.message || e || "Zero-shot load failed");
			anyPlugin.termSimilarityWorkerLastLoadErrorAt = now();
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
		const resp = await requestSimilarityWorker(plugin, { type: "loadZeroShot", modelId } as any);
		if (!!resp && (resp as any).ok === true) {
			try {
				const anyPlugin: any = plugin as any;
				anyPlugin.termSimilarityWorkerLastLoadError = null;
				anyPlugin.termSimilarityWorkerLastLoadErrorAt = null;
			} catch {
				// ignore
			}
			devConsoleLogOnce(plugin, "zeroshot:model", "[epoch] zero-shot model loaded");
			return (resp as any).type === "loadZeroShot";
		}
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}

		try {
			const anyPlugin: any = plugin as any;
			const createErr = String(anyPlugin?.similarityWorkerLastCreateError ?? "").trim();
			anyPlugin.termSimilarityWorkerLastLoadError = createErr ? `Worker unavailable: ${createErr}` : "Worker unavailable";
			anyPlugin.termSimilarityWorkerLastLoadErrorAt = now();
		} catch {
			// ignore
		}
		return false;
	} catch (e: any) {
		debugLog("zeroshot:load-failed", { err: safeStringify(e, 1500) });
		try {
			clearEpochProgress(plugin, "topics", 1500);
		} catch {
			// ignore
		}
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.termSimilarityWorkerLastLoadError = String(e?.message || e || "Zero-shot load failed");
			anyPlugin.termSimilarityWorkerLastLoadErrorAt = now();
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
		const resp = await requestSimilarityWorker(plugin, { type: "zeroShotScoreLabels", labels, sequence } as any);
		if (!resp || (resp as any).ok !== true) return null;
		if ((resp as any).type !== "zeroShotScoreLabels") return null;
		const outLabels = Array.isArray((resp as any).labels)
			? (resp as any).labels.map((x: any) => String(x || "").trim()).filter(Boolean)
			: [];
		const outScores = Array.isArray((resp as any).scores)
			? (resp as any).scores.map((x: any) => {
				const n = Number(x);
				return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
			})
			: [];
		return { labels: outLabels, scores: outScores };
	} catch (e) {
		debugLog("zeroshot:score-labels-failed", { err: safeStringify(e, 1500) });
		return null;
	}
}
