import type { EpochPlugin } from "../../main";
import { getSimilarityWorker } from "./worker-factory";

type EpochPluginWithWorkerPrime = EpochPlugin & { similarityWorkerWasmPrimed?: boolean };

export async function primeOrtWasmForWorker(plugin: EpochPlugin): Promise<boolean> {
	const pluginState = plugin as EpochPluginWithWorkerPrime;
	if (pluginState.similarityWorkerWasmPrimed) return true;
	const w = getSimilarityWorker(plugin);
	if (!w) return false;

	// WASM files are shipped in `vendor/onnxruntime-web/` and loaded by the worker via app:// paths.
	// Avoid importing `.wasm` here: inlining large binaries into `main.js` can crash Obsidian Mobile.
	pluginState.similarityWorkerWasmPrimed = true;
	return true;
}
