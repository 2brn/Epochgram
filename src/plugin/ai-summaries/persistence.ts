import { Notice } from "obsidian";
import type { EpochPlugin } from "../../main";

export function schedulePersist(plugin: EpochPlugin): void {
	if ((plugin as any).aiBridgePersistTimer != null) return;
	const timeoutFn: any = (typeof window !== "undefined" && typeof (window as any).setTimeout === "function")
		? (window as any).setTimeout.bind(window)
		: setTimeout;
	(plugin as any).aiBridgePersistTimer = timeoutFn(async () => {
		(plugin as any).aiBridgePersistTimer = null;
		try {
			await plugin.persistIndex({ skipEnsure: true });
			plugin.refreshEpochViews();
		} catch (err: any) {
			new Notice(`Failed to persist AI summaries: ${err?.message ?? String(err)}`, 5000);
		}
	}, 1500);
}
