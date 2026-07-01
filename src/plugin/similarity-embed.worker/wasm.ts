import { workerState, type OrtWasmBlobUrls } from "./state";

declare const self: Worker & { location?: Location };

// Keep in sync with package-lock.json (onnxruntime-web version used by similarity worker).
export const ONNX_RUNTIME_WEB_VERSION = "1.24.3";
export const PLUGIN_ID = "epoch";

export function getWorkerLocationDebug(): { href: string; origin: string } {
	const workerGlobal = self;
	const loc = workerGlobal?.location;
	const href = String(loc?.href || "");
	const origin = String(loc?.origin || "");
	return { href, origin };
}

export function buildOrtWasmPaths(base: string): Record<string, string> {
	const b = base.endsWith("/") ? base : base + "/";
	return {
		"ort-wasm.wasm": b + "ort-wasm.wasm",
		"ort-wasm-simd.wasm": b + "ort-wasm-simd.wasm",
		"ort-wasm-threaded.wasm": b + "ort-wasm-threaded.wasm",
		"ort-wasm-simd-threaded.wasm": b + "ort-wasm-simd-threaded.wasm"
	};
}

export function getOrtWasmCdnBase(version = ONNX_RUNTIME_WEB_VERSION): string {
	const v = String(version || "").trim() || ONNX_RUNTIME_WEB_VERSION;
	return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/`;
}

export function primeOrtWasmFromBuffers(files: Array<{ name: string; data: ArrayBuffer }>): OrtWasmBlobUrls {
	try {
		const existing = workerState.ortWasmBlobUrls;
		if (existing) {
			for (const k of Object.keys(existing)) {
				try {
					URL.revokeObjectURL(existing[k]);
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}

	const out: Record<string, string> = {};
	for (const f of files || []) {
		const name = String(f?.name || "").trim();
		const data = f?.data;
		if (!name || !(data instanceof ArrayBuffer)) continue;
		if (data.byteLength <= 0) continue;
		const blob = new Blob([data], { type: "application/wasm" });
		out[name] = URL.createObjectURL(blob);
	}
	workerState.ortWasmBlobUrls = out;
	return out;
}

