import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { AiSummaryJob } from "../ai-bridge";
import type { AiBridgeServer } from "../ai-bridge";
import { ensureAiBridgeServerRunning } from "./bridge-server";
import { isSummarizeAIEffective } from "../pro-feature-state";

const AI_ENQUEUE_COOLDOWN_MS = 1_000;

type AiEnqueueThrottleState = {
	lastQueuedAt: number;
	timerId: number | null;
	pendingJobs: AiSummaryJob[] | null;
};

function getAiEnqueueThrottleMap(plugin: EpochPlugin): Map<string, AiEnqueueThrottleState> {
	const anyPlugin: any = plugin as any;
	if (!anyPlugin.aiSummaryEnqueueThrottleByFile) {
		anyPlugin.aiSummaryEnqueueThrottleByFile = new Map<string, AiEnqueueThrottleState>();
	}
	return anyPlugin.aiSummaryEnqueueThrottleByFile as Map<string, AiEnqueueThrottleState>;
}

export function shouldApplyEnqueueCooldown(options: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean } | undefined): boolean {
	if (options?.force) return false;
	if (options?.showNotice) return false;
	if (options?.enableIfDisabled) return false;
	return true;
}

export function isAutoSummarizeEnqueue(options: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean } | undefined): boolean {
	// Auto enqueues are those without an explicit user action.
	// The Summarize AI checkbox controls only auto-generation.
	return shouldApplyEnqueueCooldown(options);
}

export async function enqueueThrottledJobs(
	plugin: EpochPlugin,
	filePath: string,
	jobs: AiSummaryJob[],
	options: { showNotice?: boolean; allowWhenSummarizeAIDisabled?: boolean } | undefined
): Promise<void> {
	if (jobs.length === 0) return;

	const map = getAiEnqueueThrottleMap(plugin);
	let state = map.get(filePath);
	if (!state) {
		state = { lastQueuedAt: 0, timerId: null, pendingJobs: null };
		map.set(filePath, state);
	}

	const now = Date.now();
	const elapsed = now - (state.lastQueuedAt || 0);
	const remaining = AI_ENQUEUE_COOLDOWN_MS - elapsed;

	const enqueueNow = async (batch: AiSummaryJob[]) => {
		await ensureAiBridgeServerRunning(plugin);
		const bridge: AiBridgeServer = (plugin as any).aiBridge;
		bridge.enqueue(batch);
		state!.lastQueuedAt = Date.now();
		if (options?.showNotice) {
			new Notice(`AI summaries: queued ${batch.length} job(s).`);
		}
		if (!bridge.getStatus().clientConnected) {
			void (plugin as any).openAiBridgeWindow?.({ silent: true });
		}
	};

	if (remaining <= 0 || state.lastQueuedAt === 0) {
		if (state.timerId != null) {
			window.clearTimeout(state.timerId);
			state.timerId = null;
			state.pendingJobs = null;
		}
		await enqueueNow(jobs);
		return;
	}

	state.pendingJobs = jobs;
	if (state.timerId == null) {
		state.timerId = window.setTimeout(() => {
			void (async () => {
				state!.timerId = null;
				const pending = state!.pendingJobs;
				state!.pendingJobs = null;
				if (!pending || pending.length === 0) return;
				try {
					if (!Platform.isDesktopApp) return;
					if (!options?.allowWhenSummarizeAIDisabled && !isSummarizeAIEffective(plugin)) return;
					await enqueueNow(pending);
				} catch { void 0; }
			})();
		}, Math.max(0, remaining));
	}
}
