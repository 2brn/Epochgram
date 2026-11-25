import type { EpochPlugin } from "../main";

type Runtime = EpochPlugin & { __epochSearchRefreshTimer?: number; __epochSearchRefreshRegistered?: boolean; __epochSearchRefreshDisposed?: boolean; __epochSearchRefreshRunning?: boolean; __epochSearchRefreshRequest?: number; timelineSearchRebuildStartedAt?: number };

/** Keep cached full-text search usable immediately, then reconcile it with vault content. */
export function scheduleTimelineSearchRebuild(plugin: EpochPlugin): void {
	const runtime = plugin as Runtime;
	if (runtime.__epochSearchRefreshDisposed || typeof plugin.rebuildTimelineSearchIndex !== "function") return;
	if (!runtime.__epochSearchRefreshRegistered) {
		runtime.__epochSearchRefreshRegistered = true;
		plugin.register?.(() => {
			runtime.__epochSearchRefreshDisposed = true;
			if (runtime.__epochSearchRefreshTimer != null) window.clearTimeout(runtime.__epochSearchRefreshTimer);
			delete runtime.__epochSearchRefreshTimer;
		});
	}
	runtime.__epochSearchRefreshRequest = (runtime.__epochSearchRefreshRequest ?? 0) + 1;
	if (runtime.__epochSearchRefreshRunning) return;
	if (runtime.__epochSearchRefreshTimer != null) window.clearTimeout(runtime.__epochSearchRefreshTimer);
	runtime.__epochSearchRefreshTimer = window.setTimeout(() => {
		delete runtime.__epochSearchRefreshTimer;
		if (runtime.__epochSearchRefreshDisposed) return;
		if (runtime.timelineSearchRebuildStartedAt) { scheduleTimelineSearchRebuild(plugin); return; }
		const request = runtime.__epochSearchRefreshRequest;
		runtime.__epochSearchRefreshRunning = true;
		void plugin.rebuildTimelineSearchIndex().catch(error => console.error("Epochgram: Search refresh failed", error)).finally(() => {
			runtime.__epochSearchRefreshRunning = false;
			if (runtime.__epochSearchRefreshRequest !== request) scheduleTimelineSearchRebuild(plugin);
		});
	}, 2500);
}
