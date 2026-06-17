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

function getTopicsPath(plugin: EpochPlugin): string {
	const anyPlugin: any = plugin as any;
	return String(anyPlugin?.termSimilarityFilePath || "");
}


function normalizeStoreModel(plugin: EpochPlugin, model: any): string {
	try {
		const s = String(model ?? "").trim();
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
				await (plugin as any).updateTermSimilarityFileStat?.();
			} catch { void 0; }
			return;
		}
		try {
			await (plugin as any).updateTermSimilarityFileStat?.();
		} catch { void 0; }
	} catch { void 0; }
}

export async function readTermStore(plugin: EpochPlugin): Promise<TermClassificationStore> {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.termSimilarityIndex && anyPlugin.termSimilarityLoaded) {
		return anyPlugin.termSimilarityIndex as TermClassificationStore;
	}
	const empty: TermClassificationStore = emptyTopicsStore(plugin);
	try {
		const p = getTopicsPath(plugin);
		if (!p) {
			anyPlugin.termSimilarityIndex = empty;
			anyPlugin.termSimilarityLoaded = true;
			return empty;
		}
		const exists = await plugin.app.vault.adapter.exists(p);
		if (!exists) {
			anyPlugin.termSimilarityIndex = empty;
			anyPlugin.termSimilarityLoaded = true;
			return empty;
		}
		const raw = await plugin.app.vault.adapter.read(p);
		const parsed = JSON.parse(raw || "{}");
		const effectiveModel = normalizeStoreModel(plugin, parsed?.model);
		const store: TermClassificationStore = {
			model: effectiveModel,
			files: typeof parsed?.files === "object" && parsed.files ? parsed.files : {}
		};

		anyPlugin.termSimilarityIndex = store;
		anyPlugin.termSimilarityLoaded = true;
		return store;
	} catch {
		anyPlugin.termSimilarityIndex = empty;
		anyPlugin.termSimilarityLoaded = true;
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
			const anyPlugin: any = plugin as any;
			anyPlugin.termSimilarityStoreRev = (typeof anyPlugin.termSimilarityStoreRev === "number" ? anyPlugin.termSimilarityStoreRev : 0) + 1;
		} catch { void 0; }
		try {
			(plugin as any).scheduleInheritedMarkRecompute?.("termSimilarity");
		} catch { void 0; }
	} catch { void 0; }
}
