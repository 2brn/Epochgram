import type { EpochPlugin } from "../../main";
import { getSimilarityWorker } from "./worker-factory";

export async function primeOrtWasmForWorker(plugin: EpochPlugin): Promise<boolean> {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.similarityWorkerWasmPrimed) return true;
	const w = getSimilarityWorker(plugin);
	if (!w) return false;

	// WASM files are shipped in `vendor/onnxruntime-web/` and loaded by the worker via app:// paths.
	// Avoid importing `.wasm` here: inlining large binaries into `main.js` can crash Obsidian Mobile.
	anyPlugin.similarityWorkerWasmPrimed = true;
	return true;
}
