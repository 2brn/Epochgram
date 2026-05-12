import { withProcessMasked } from "./process-mask";
import { workerState } from "./state";

function installNetworkFetchGuard(): void {
	const anyGlobal: any = globalThis as any;
	if (anyGlobal.__epochNetworkFetchGuardInstalled) return;
	anyGlobal.__epochNetworkFetchGuardInstalled = true;

	const origFetch: any = (globalThis as any).fetch;
	if (typeof origFetch !== "function") return;

	(globalThis as any).fetch = (input: any, init?: any) => {
		let url: string | undefined;
		if (typeof input === "string") url = input;
		else if (input && typeof input.url === "string") url = input.url;

		if (url) {
			try {
				const base = (globalThis as any)?.location?.href;
				const parsed = base ? new URL(url, base) : new URL(url);
				if (parsed.protocol === "http:" || parsed.protocol === "https:") {
					const host = String(parsed.host || "").toLowerCase();
					const isAllowedOrtCdn =
						parsed.protocol === "https:" &&
						parsed.host === "cdn.jsdelivr.net" &&
						parsed.pathname.startsWith("/npm/onnxruntime-web@");
					const isAllowedHuggingFace =
						parsed.protocol === "https:" &&
						(host === "huggingface.co" || host.endsWith(".huggingface.co") || host === "hf.co" || host.endsWith(".hf.co"));
					if (!isAllowedOrtCdn && !isAllowedHuggingFace) {
						throw new Error(`Network fetch blocked in similarity worker: ${parsed.protocol}//${parsed.host}`);
					}
				}
			} catch (e) {
				if (e instanceof Error && e.message.startsWith("Network fetch blocked")) throw e;
			}
		}

		return origFetch(input, init);
	};
}

export async function getTransformers(): Promise<any> {
	if (workerState.transformers) return workerState.transformers;
	return await withProcessMasked(async () => {
		installNetworkFetchGuard();
		workerState.transformers = await import("@huggingface/transformers");
		return workerState.transformers;
	});
}

export async function getOrt(): Promise<any> {
	if (workerState.ort) return workerState.ort;
	return await withProcessMasked(async () => {
		installNetworkFetchGuard();
		workerState.ort = await import("onnxruntime-web");
		return workerState.ort;
	});
}

export function assertOrtAvailable(ortAny: any): void {
	const hasCreate = typeof ortAny?.InferenceSession?.create === "function";
	if (hasCreate) return;
	const keys = (() => {
		try {
			return Object.keys(ortAny || {}).slice(0, 50);
		} catch {
			return [];
		}
	})();
	throw new Error(
		`onnxruntime-web is not fully available in worker (InferenceSession.create missing). keys=${JSON.stringify(keys)}`
	);
}
