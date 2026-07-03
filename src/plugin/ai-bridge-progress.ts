import { Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { clearEpochProgress, setEpochProgress } from "./progress";
import { hasAiBridgeAccess } from "./pro-feature-state";

type BridgeJobLike = { kind?: string };

type BridgeStatusLike = {
	queued?: unknown;
	inProgress?: unknown;
	done?: unknown;
	errors?: unknown;
	epochTotal?: unknown;
	epochProcessed?: unknown;
};

type BridgeLike = {
	pending?: unknown;
	inProgress?: unknown;
	getStatus?: () => unknown;
};

type AiBridgeProgressPluginState = {
	epochRegenAfterAiTimer?: number | null;
	epochRegenAfterAiBucketsQueue?: unknown;
	__epochEpochHierarchyTotalJobs?: unknown;
	__epochEpochHierarchyTotalTokens?: unknown;
	__epochEpochHierarchyRunKey?: unknown;
	__epochAiProgressWasActive?: unknown;
	__epochAiProgressBaselineDone?: unknown;
	__epochAiProgressBaselineErrors?: unknown;
	aiBridge?: BridgeLike | null;
};

function asBridgeStatus(value: unknown): BridgeStatusLike | null {
	return value && typeof value === "object" ? value : null;
}

function safeNumber(v: unknown): number {
	const n = Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function hasPlannedEpochCascade(plugin: AiBridgeProgressPluginState): boolean {
	try {
		if (!plugin) return false;
		if (plugin.epochRegenAfterAiTimer != null) return true;
		const q = plugin.epochRegenAfterAiBucketsQueue;
		if (Array.isArray(q) && q.length > 0) return true;
		return false;
	} catch {
		return false;
	}
}

function getPlannedEpochTotal(plugin: AiBridgeProgressPluginState): number | null {
	try {
		const n = Number(plugin?.__epochEpochHierarchyTotalJobs ?? 0);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
	} catch {
		return null;
	}
}

function getBridgeKindCounts(bridge: BridgeLike | null): {
	summariesQueued: number;
	summariesInProgress: number;
	epochsQueued: number;
	epochsInProgress: number;
} {
	try {
		const pending: BridgeJobLike[] = Array.isArray(bridge?.pending) ? (bridge?.pending as BridgeJobLike[]) : [];
		const inProgressValues: BridgeJobLike[] = bridge?.inProgress instanceof Map ? Array.from(bridge.inProgress.values() as Iterable<BridgeJobLike>) : [];
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
	if (!Platform.isDesktop) return;

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

	const state = plugin as EpochPlugin & AiBridgeProgressPluginState;
	const bridge = state.aiBridge ?? null;
	let status: BridgeStatusLike | null = null;
	try {
		const raw = bridge?.getStatus?.() ?? null;
		status = asBridgeStatus(raw);
	} catch {
		status = null;
	}

	const queued = safeNumber(status?.queued);
	const inProgress = safeNumber(status?.inProgress);
	const epochPlanActive = hasPlannedEpochCascade(state);
	const hasWork = queued > 0 || inProgress > 0 || epochPlanActive;
	const plannedEpochTotal = getPlannedEpochTotal(state);
	const doneNow = clampInt(safeNumber(status?.done));
	const errorsNow = clampInt(safeNumber(status?.errors));
	const wasActive = state.__epochAiProgressWasActive === true;

	if (!hasWork) {
		try {
			state.__epochEpochHierarchyTotalJobs = 0;
			state.__epochEpochHierarchyTotalTokens = 0;
			state.__epochEpochHierarchyRunKey = 0;
			state.__epochAiProgressWasActive = false;
			state.__epochAiProgressBaselineDone = doneNow;
			state.__epochAiProgressBaselineErrors = errorsNow;
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
			state.__epochAiProgressWasActive = true;
			state.__epochAiProgressBaselineDone = doneNow;
			state.__epochAiProgressBaselineErrors = errorsNow;
		} catch {
			// ignore
		}
	}

	try {
		const baselineDone = clampInt(safeNumber(state.__epochAiProgressBaselineDone));
		const baselineErrors = clampInt(safeNumber(state.__epochAiProgressBaselineErrors));
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
