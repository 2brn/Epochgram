import type { EpochPlugin } from "../main";
import { getZeroShotModelId } from "./similarity/config";

type TermClassificationFileRecord = {
	term: string;
	score: number;
	h: string;
	vocabularySig: string;
	updatedAt: number;
};

type TermClassificationStore = {
	model: string;
	files: Record<string, TermClassificationFileRecord>;
};

type ParsedTermStore = {
	model?: unknown;
	files?: unknown;
};

type TermStorePluginState = {
	termSimilarityFilePath?: string;
	updateTermSimilarityFileStat?: () => Promise<void>;
	termSimilarityIndex?: TermClassificationStore;
	termSimilarityLoaded?: boolean;
	termSimilarityStoreRev?: number;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
};

function getTopicsPath(plugin: EpochPlugin): string {
	return String((plugin as EpochPlugin & TermStorePluginState).termSimilarityFilePath || "");
}


function normalizeStoreModel(plugin: EpochPlugin, model: unknown): string {
	try {
		if (typeof model !== "string") return getZeroShotModelId(plugin);
		const s = model.trim();
		if (s && s.toLowerCase() !== "zeroshot") return s;
	} catch {
		// ignore
	}
	return getZeroShotModelId(plugin);
}

function emptyTopicsStore(plugin: EpochPlugin): TermClassificationStore {
	return { model: normalizeStoreModel(plugin, null), files: {} };
}

export async function ensureTermStoreFileExists(plugin: EpochPlugin): Promise<void> {
	try {
		const p = getTopicsPath(plugin);
		if (!p) return;
		const exists = await plugin.app.vault.adapter.exists(p);
		if (!exists) {
			await plugin.app.vault.adapter.write(p, JSON.stringify(emptyTopicsStore(plugin)));
			try {
				await (plugin as EpochPlugin & TermStorePluginState).updateTermSimilarityFileStat?.();
			} catch { void 0; }
			return;
		}
		try {
			await (plugin as EpochPlugin & TermStorePluginState).updateTermSimilarityFileStat?.();
		} catch { void 0; }
	} catch { void 0; }
}

export async function readTermStore(plugin: EpochPlugin): Promise<TermClassificationStore> {
	const state = plugin as EpochPlugin & TermStorePluginState;
	if (state.termSimilarityIndex && state.termSimilarityLoaded) {
		return state.termSimilarityIndex;
	}
	const empty: TermClassificationStore = emptyTopicsStore(plugin);
	try {
		const p = getTopicsPath(plugin);
		if (!p) {
			state.termSimilarityIndex = empty;
			state.termSimilarityLoaded = true;
			return empty;
		}
		const exists = await plugin.app.vault.adapter.exists(p);
		if (!exists) {
			state.termSimilarityIndex = empty;
			state.termSimilarityLoaded = true;
			return empty;
		}
		const raw = await plugin.app.vault.adapter.read(p);
		const parsed = JSON.parse(raw || "{}") as ParsedTermStore;
		const effectiveModel = normalizeStoreModel(plugin, parsed?.model);
		const parsedFiles = parsed?.files;
		const files = parsedFiles && typeof parsedFiles === "object" && !Array.isArray(parsedFiles) ? parsedFiles : {};
		const store: TermClassificationStore = {
			model: effectiveModel,
			files: files as Record<string, TermClassificationFileRecord>
		};

		state.termSimilarityIndex = store;
		state.termSimilarityLoaded = true;
		return store;
	} catch {
		state.termSimilarityIndex = empty;
		state.termSimilarityLoaded = true;
		return empty;
	}
}

export async function writeTermStore(plugin: EpochPlugin, store: TermClassificationStore): Promise<void> {
	try {
		const p = getTopicsPath(plugin);
		if (!p) return;
		try {
			store.model = normalizeStoreModel(plugin, store.model);
		} catch {
			// ignore
		}
		await plugin.app.vault.adapter.write(p, JSON.stringify(store));
		try {
			const state = plugin as EpochPlugin & TermStorePluginState;
			state.termSimilarityStoreRev = (typeof state.termSimilarityStoreRev === "number" ? state.termSimilarityStoreRev : 0) + 1;
		} catch { void 0; }
		try {
			(plugin as EpochPlugin & TermStorePluginState).scheduleInheritedMarkRecompute?.("termSimilarity");
		} catch { void 0; }
	} catch { void 0; }
}
