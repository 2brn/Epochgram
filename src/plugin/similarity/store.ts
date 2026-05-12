import type { EpochPlugin } from "../../main";
import { embeddingsSimilarityEnabled, getSimilarityModelId } from "./config";
import type { SimilarityStore } from "./types";

type SimilarityStoreDiskV2 = {
	models: Record<
		string,
		{
			dim: number;
			files: Record<string, any>;
		}
	>;
};

export async function readStore(plugin: EpochPlugin): Promise<SimilarityStore> {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.similarityIndex && anyPlugin.similarityVectorsLoaded) {
		return anyPlugin.similarityIndex as SimilarityStore;
	}

	const modelId = getSimilarityModelId(plugin);
	const empty: SimilarityStore = { model: modelId, dim: 0, files: {} };

	// When embeddings similarity is not enabled (disabled/graph/threshold off), do not
	// load or mutate the store on disk.
	if (!embeddingsSimilarityEnabled(plugin)) {
		// Important: do not cache an empty store here.
		// If the user later re-enables embeddings, we need to load from disk.
		return empty;
	}

	try {
		const exists = await plugin.app.vault.adapter.exists((plugin as any).vectorsFilePath);
		if (!exists) {
			anyPlugin.similarityIndex = empty;
			anyPlugin.similarityVectorsLoaded = true;
			return empty;
		}
		const raw = await plugin.app.vault.adapter.read((plugin as any).vectorsFilePath);
		const parsed = JSON.parse(raw || "{}");

		let store: SimilarityStore = empty;
		// Disk store is multi-model: { models: { [modelId]: { dim, files } } }.
		const models = parsed && typeof parsed === "object" ? (parsed as any).models : null;
		if (models && typeof models === "object") {
			const entry = (models as any)?.[modelId];
			if (entry && typeof entry === "object") {
				store = {
					model: modelId,
					dim: typeof (entry as any)?.dim === "number" ? (entry as any).dim : 0,
					files: typeof (entry as any)?.files === "object" && (entry as any).files ? (entry as any).files : {}
				};
			}
		}

		anyPlugin.similarityIndex = store;
		anyPlugin.similarityVectorsLoaded = true;
		return store;
	} catch {
		anyPlugin.similarityIndex = empty;
		anyPlugin.similarityVectorsLoaded = true;
		return empty;
	}
}

export async function writeStore(plugin: EpochPlugin, store: SimilarityStore): Promise<void> {
	try {
		await (plugin as any).ensurePluginDir?.();

		// Preserve vectors for other models by writing a multi-model store.
		let disk: SimilarityStoreDiskV2 = { models: {} };
		try {
			const exists = await plugin.app.vault.adapter.exists((plugin as any).vectorsFilePath);
			if (exists) {
				const raw = await plugin.app.vault.adapter.read((plugin as any).vectorsFilePath);
				const parsed = JSON.parse(raw || "{}");
				const models = parsed && typeof parsed === "object" ? (parsed as any).models : null;
				if (models && typeof models === "object") {
					disk = { models } as SimilarityStoreDiskV2;
				}
			}
		} catch {
			// If reading existing store fails, fall back to writing only the active model.
		}

		// Avoid persisting epoch-generated vectors; they are not used for similarity.
		try {
			for (const k of Object.keys(store.files || {})) {
				if (String(k || "").startsWith("epoch://")) {
					delete (store.files as any)[k];
				}
			}
		} catch {
			// ignore
		}

		(disk.models as any)[store.model] = { dim: store.dim, files: store.files };
		await plugin.app.vault.adapter.write((plugin as any).vectorsFilePath, JSON.stringify(disk));
		try {
			const anyPlugin: any = plugin as any;
			anyPlugin.similarityStoreRev =
				(typeof anyPlugin.similarityStoreRev === "number" ? anyPlugin.similarityStoreRev : 0) + 1;
		} catch {
			// ignore
		}
		try {
			(plugin as any).scheduleInheritedMarkRecompute?.("similarity");
		} catch {
			// ignore
		}
	} catch (error) {
		void error;
	}
}
