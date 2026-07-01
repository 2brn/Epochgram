import type { EpochPlugin } from "../../main";
import { embeddingsSimilarityEnabled, getSimilarityModelId } from "./config";
import type { SimilarityFileVector, SimilarityStore } from "./types";

type SimilarityStoreDiskModel = {
	dim: number;
	files: Record<string, SimilarityFileVector>;
};

type SimilarityStoreDiskV2 = {
	models: Record<string, SimilarityStoreDiskModel>;
};

type SimilarityPluginState = {
	similarityIndex?: SimilarityStore;
	similarityVectorsLoaded?: boolean;
	similarityStoreRev?: number;
	vectorsFilePath?: string;
	ensurePluginDir?: () => Promise<void>;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asPluginState(plugin: EpochPlugin): EpochPlugin & SimilarityPluginState {
	return plugin as EpochPlugin & SimilarityPluginState;
}

function normalizeVectorFileVector(value: unknown): SimilarityFileVector | null {
	const record = asRecord(value);
	const vector = Array.isArray(record.v) ? record.v.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
	const hash = typeof record.h === "string" ? record.h : "";
	const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
	if (vector.length === 0 && !hash) return null;
	return { v: vector, h: hash, updatedAt };
}

function normalizeStoreFiles(value: unknown): Record<string, SimilarityFileVector> {
	const record = asRecord(value);
	const out: Record<string, SimilarityFileVector> = {};
	for (const [path, fileVector] of Object.entries(record)) {
		const normalized = normalizeVectorFileVector(fileVector);
		if (normalized) out[path] = normalized;
	}
	return out;
}

export async function readStore(plugin: EpochPlugin): Promise<SimilarityStore> {
	const state = asPluginState(plugin);
	if (state.similarityIndex && state.similarityVectorsLoaded) {
		return state.similarityIndex;
	}

	const modelId = getSimilarityModelId(plugin);
	const empty: SimilarityStore = { model: modelId, dim: 0, files: {} };

	if (!embeddingsSimilarityEnabled(plugin)) {
		return empty;
	}

	try {
		const vectorsFilePath = state.vectorsFilePath ?? "";
		const exists = await plugin.app.vault.adapter.exists(vectorsFilePath);
		if (!exists) {
			state.similarityIndex = empty;
			state.similarityVectorsLoaded = true;
			return empty;
		}

		const raw = await plugin.app.vault.adapter.read(vectorsFilePath);
		const parsed = asRecord(JSON.parse(raw || "{}"));
		const models = asRecord(parsed.models);
		const modelRecord = asRecord(models[modelId]);
		const store: SimilarityStore = {
			model: modelId,
			dim: typeof modelRecord.dim === "number" && Number.isFinite(modelRecord.dim) ? modelRecord.dim : 0,
			files: normalizeStoreFiles(modelRecord.files)
		};

		state.similarityIndex = store;
		state.similarityVectorsLoaded = true;
		return store;
	} catch {
		state.similarityIndex = empty;
		state.similarityVectorsLoaded = true;
		return empty;
	}
}

export async function writeStore(plugin: EpochPlugin, store: SimilarityStore): Promise<void> {
	const state = asPluginState(plugin);
	try {
		await state.ensurePluginDir?.();

		let disk: SimilarityStoreDiskV2 = { models: {} };
		try {
			const vectorsFilePath = state.vectorsFilePath ?? "";
			const exists = await plugin.app.vault.adapter.exists(vectorsFilePath);
			if (exists) {
				const raw = await plugin.app.vault.adapter.read(vectorsFilePath);
				const parsed = asRecord(JSON.parse(raw || "{}"));
				const models = asRecord(parsed.models);
				for (const [modelId, modelValue] of Object.entries(models)) {
					const modelRecord = asRecord(modelValue);
					disk.models[modelId] = {
						dim: typeof modelRecord.dim === "number" && Number.isFinite(modelRecord.dim) ? modelRecord.dim : 0,
						files: normalizeStoreFiles(modelRecord.files)
					};
				}
			}
		} catch {
			// If reading existing store fails, fall back to writing only the active model.
		}

		const files: Record<string, SimilarityFileVector> = {};
		for (const [path, fileVector] of Object.entries(store.files || {})) {
			if (String(path || "").startsWith("epoch://")) continue;
			files[path] = fileVector;
		}

		disk.models[store.model] = { dim: store.dim, files };
		await plugin.app.vault.adapter.write(state.vectorsFilePath ?? "", JSON.stringify(disk));
		try {
			state.similarityStoreRev = (typeof state.similarityStoreRev === "number" ? state.similarityStoreRev : 0) + 1;
		} catch {
			// ignore
		}
		try {
			state.scheduleInheritedMarkRecompute?.("similarity");
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}
