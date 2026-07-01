import { withProcessMasked } from "./process-mask";
import { workerState } from "./state";

type WorkerLocationLike = {
	href?: string;
};

type WorkerGlobalLike = {
	__epochNetworkFetchGuardInstalled?: boolean;
	fetch?: (input: unknown, init?: unknown) => Promise<unknown>;
	location?: WorkerLocationLike;
};

declare const self: WorkerGlobalLike;

type ImportableModule = Record<string, unknown>;

type OrtLike = ImportableModule & {
	InferenceSession?: {
		create?: unknown;
	};
};

const workerGlobal = self;

function installNetworkFetchGuard(): void {
	if (workerGlobal.__epochNetworkFetchGuardInstalled) return;
	workerGlobal.__epochNetworkFetchGuardInstalled = true;

	const origFetch = workerGlobal.fetch;
	if (typeof origFetch !== "function") return;

	workerGlobal.fetch = (input: unknown, init?: unknown) => {
		let url: string | undefined;
		if (typeof input === "string") url = input;
		else if (input instanceof URL) url = input.toString();
		else if (input && typeof input === "object" && "url" in input) {
			const candidate = input.url;
			if (typeof candidate === "string") url = candidate;
		}

		if (url) {
			try {
				const base = workerGlobal.location?.href;
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

export async function getTransformers(): Promise<ImportableModule> {
	if (workerState.transformers) return workerState.transformers;
	return await withProcessMasked(async () => {
		installNetworkFetchGuard();
		workerState.transformers = await import("@huggingface/transformers");
		return workerState.transformers;
	});
}

export async function getOrt(): Promise<ImportableModule> {
	if (workerState.ort) return workerState.ort;
	return await withProcessMasked(async () => {
		installNetworkFetchGuard();
		workerState.ort = await import("onnxruntime-web");
		return workerState.ort;
	});
}


export function assertOrtAvailable(ortAny: unknown): void {
	const ort = ortAny as OrtLike;
	const hasCreate = typeof ort.InferenceSession?.create === "function";
	if (hasCreate) return;
	const keys = (() => {
		try {
			const ortRecord: Record<string, unknown> = ort;
			return Object.keys(ortRecord).slice(0, 50);
		} catch {
			return [];
		}
	})();
	throw new Error(
		`onnxruntime-web is not fully available in worker (InferenceSession.create missing). keys=${JSON.stringify(keys)}`
	);
}
