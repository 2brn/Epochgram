import type { EpochPlugin } from "../../main";
import type { WorkerEmbedResponse } from "./types";
import { getSimilarityWorker } from "./worker-factory";

type PendingWorkerRequest = {
	resolve: (value: WorkerEmbedResponse) => void;
	reject: (reason?: unknown) => void;
};

type SimilarityWorkerState = {
	similarityWorkerPending?: Map<number, PendingWorkerRequest>;
	similarityWorkerNextId?: number;
};

export async function requestSimilarityWorker(
	plugin: EpochPlugin,
	msg: Record<string, unknown>,
	transfer?: Transferable[]
): Promise<WorkerEmbedResponse | null> {
	const w = getSimilarityWorker(plugin);
	if (!w) return null;
	const state = plugin as EpochPlugin & SimilarityWorkerState;
	const pending = state.similarityWorkerPending;
	if (!pending) return null;

	const nextId = typeof state.similarityWorkerNextId === "number" ? state.similarityWorkerNextId : 1;
	const id = nextId;
	state.similarityWorkerNextId = nextId + 1;

	const promise = new Promise<WorkerEmbedResponse>((resolve, reject) => {
		pending.set(id, { resolve, reject });
	});

	try {
		if (transfer && Array.isArray(transfer) && transfer.length > 0) {
			w.postMessage({ ...msg, id }, transfer);
		} else {
			w.postMessage({ ...msg, id });
		}
	} catch (e) {
		pending.delete(id);
		throw e;
	}

	return await promise;
}
