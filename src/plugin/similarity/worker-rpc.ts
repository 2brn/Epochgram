import type { EpochPlugin } from "../../main";
import type { WorkerEmbedResponse } from "./types";
import { getSimilarityWorker } from "./worker-factory";

export async function requestSimilarityWorker(
	plugin: EpochPlugin,
	msg: any,
	transfer?: Transferable[]
): Promise<WorkerEmbedResponse | null> {
	const w = getSimilarityWorker(plugin);
	if (!w) return null;
	const anyPlugin: any = plugin as any;
	const pending: Map<number, any> = anyPlugin.similarityWorkerPending;
	if (!pending) return null;

	const nextId = typeof anyPlugin.similarityWorkerNextId === "number" ? anyPlugin.similarityWorkerNextId : 1;
	const id = nextId;
	anyPlugin.similarityWorkerNextId = nextId + 1;

	const promise = new Promise<WorkerEmbedResponse>((resolve, reject) => {
		pending.set(id, { resolve, reject });
	});

	try {
		if (transfer && Array.isArray(transfer) && transfer.length > 0) {
			(w as any).postMessage({ ...(msg as any), id } as any, transfer as any);
		} else {
			w.postMessage({ ...(msg as any), id } as any);
		}
	} catch (e) {
		pending.delete(id);
		throw e;
	}

	return await promise;
}
