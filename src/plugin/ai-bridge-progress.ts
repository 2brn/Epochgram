import { Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { clearEpochProgress, setEpochProgress } from "./progress";
import { hasAiBridgeAccess } from "./pro-feature-state";

function safeNumber(v: any): number {
	const n = Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function hasPlannedEpochCascade(plugin: any): boolean {
	try {
		if (!plugin) return false;
		if (plugin.epochRegenAfterAiTimer != null) return true;
		const q: any = plugin.epochRegenAfterAiBucketsQueue;
		if (Array.isArray(q) && q.length > 0) return true;
		return false;
	} catch {
		return false;
	}
}

function getPlannedEpochTotal(plugin: any): number | null {
	try {
		const n = Number(plugin?.__epochEpochHierarchyTotalJobs ?? 0);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
	} catch {
		return null;
	}
}

function getBridgeKindCounts(bridge: any): {
	summariesQueued: number;
	summariesInProgress: number;
	epochsQueued: number;
	epochsInProgress: number;
} {
	try {
		const pending: any[] = Array.isArray(bridge?.pending) ? bridge.pending : [];
		const inProgressValues: any[] = bridge?.inProgress instanceof Map ? Array.from(bridge.inProgress.values()) : [];
		let summariesQueued = 0;
		let summariesInProgress = 0;
		let epochsQueued = 0;
		let epochsInProgress = 0;
		for (const j of pending) {
			if (!j) continue;
			if (j.kind === "epoch") epochsQueued++;
			else summariesQueued++;
		}
		for (const j of inProgressValues) {
			if (!j) continue;
			if (j.kind === "epoch") epochsInProgress++;
			else summariesInProgress++;
		}
		return { summariesQueued, summariesInProgress, epochsQueued, epochsInProgress };
	} catch {
		return { summariesQueued: 0, summariesInProgress: 0, epochsQueued: 0, epochsInProgress: 0 };
	}
}

function clampInt(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

function formatProgress(label: string, done: number, total: number): string {
	const d = clampInt(done);
	const t = Math.max(1, clampInt(total));
	return `${label}… ${Math.min(d, t)}/${t}`;
}

export function refreshAiBridgeProgress(plugin: EpochPlugin): void {
	if (!Platform.isDesktopApp) return;

	let hasPro = false;
	try {
		hasPro = hasAiBridgeAccess(plugin);
	} catch {
		hasPro = false;
	}
	if (!hasPro) {
		try {
			clearEpochProgress(plugin, "ai", 0);
		} catch {
			// ignore
		}
		return;
	}

	const anyPlugin: any = plugin as any;
	const bridge: any = anyPlugin.aiBridge ?? null;
	let status: any = null;
	try {
		status = bridge?.getStatus?.() ?? null;
	} catch {
		status = null;
	}

	const queued = safeNumber(status?.queued);
	const inProgress = safeNumber(status?.inProgress);
	const epochPlanActive = hasPlannedEpochCascade(anyPlugin);
	const hasWork = queued > 0 || inProgress > 0 || epochPlanActive;
	const plannedEpochTotal = getPlannedEpochTotal(anyPlugin);
	const doneNow = clampInt(safeNumber(status?.done));
	const errorsNow = clampInt(safeNumber(status?.errors));
	const wasActive = anyPlugin.__epochAiProgressWasActive === true;

	if (!hasWork) {
		try {
			anyPlugin.__epochEpochHierarchyTotalJobs = 0;
			anyPlugin.__epochEpochHierarchyTotalTokens = 0;
			anyPlugin.__epochEpochHierarchyRunKey = 0;
			anyPlugin.__epochAiProgressWasActive = false;
			anyPlugin.__epochAiProgressBaselineDone = doneNow;
			anyPlugin.__epochAiProgressBaselineErrors = errorsNow;
		} catch {
			// ignore
		}
		try {
			clearEpochProgress(plugin, "ai", 0);
		} catch {
			// ignore
		}
		return;
	}

	const counts = getBridgeKindCounts(bridge);

	if (!wasActive) {
		try {
			anyPlugin.__epochAiProgressWasActive = true;
			anyPlugin.__epochAiProgressBaselineDone = doneNow;
			anyPlugin.__epochAiProgressBaselineErrors = errorsNow;
		} catch {
			// ignore
		}
	}

	try {
		const baselineDone = clampInt(safeNumber(anyPlugin.__epochAiProgressBaselineDone));
		const baselineErrors = clampInt(safeNumber(anyPlugin.__epochAiProgressBaselineErrors));
		const processedAll = clampInt((doneNow - baselineDone) + (errorsNow - baselineErrors));
		const remainingInBridge = clampInt(queued + inProgress);

		const epochTotalPlanned = (() => {
			const n = safeNumber(status?.epochTotal);
			if (n > 0) return clampInt(n);
			if (plannedEpochTotal != null && plannedEpochTotal > 0) return clampInt(plannedEpochTotal);
			return 0;
		})();
		const epochProcessed = clampInt(safeNumber(status?.epochProcessed));
		const epochRemaining = epochTotalPlanned > 0 ? Math.max(0, epochTotalPlanned - epochProcessed) : 0;
		const epochsInBridge = clampInt(counts.epochsQueued + counts.epochsInProgress);
		const deferredEpoch = Math.max(0, clampInt(epochRemaining) - epochsInBridge);

		const total = Math.max(1, processedAll + remainingInBridge + (epochPlanActive ? deferredEpoch : 0));
		setEpochProgress(plugin, "ai", formatProgress("Summarization", processedAll, total));
	} catch {
		// ignore
	}
}
