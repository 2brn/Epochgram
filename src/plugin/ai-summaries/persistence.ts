import { Notice } from "obsidian";
import type { EpochPlugin } from "../../main";

type AiPersistState = {
	aiBridgePersistTimer?: number | null;
};

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && typeof error.message === "string" && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Unknown error";
}

export function schedulePersist(plugin: EpochPlugin): void {
	const state: AiPersistState = plugin;
	if (state.aiBridgePersistTimer != null) return;
	if (typeof window === "undefined") return;
	state.aiBridgePersistTimer = window.setTimeout(() => {
		void (async () => {
			state.aiBridgePersistTimer = null;
			try {
				await plugin.persistIndex({ skipEnsure: true });
				plugin.refreshEpochViews();
			} catch (error) {
				new Notice(`Failed to persist AI summaries: ${getErrorMessage(error)}`, 5000);
			}
		})();
	}, 1500);
}
