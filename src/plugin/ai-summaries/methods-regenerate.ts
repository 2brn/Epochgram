import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import { scheduleEpochRegenerationAfterAiIdle } from "./epochs-after-ai";
import { hasGenerateEpochsAccess, hasSummarizeAIAccess, isGenerateEpochsEffective, isSummarizeAIEffective } from "../pro-feature-state";

function getAiEnqueueCancelKey(plugin: EpochPlugin): number {
	try {
		return Number((plugin as any)?.__epochAiEnqueueCancelKey) || 0;
	} catch {
		return 0;
	}
}

async function getPlannedEpochJobCount(plugin: EpochPlugin, mode: "force" | "missing"): Promise<number> {
	try {
		const mod = await import("./epochs-build");
		const buildEpochJobs: unknown = (mod as any)?.buildEpochJobs;
		if (typeof buildEpochJobs !== "function") return 0;
		const jobs = await (buildEpochJobs as any)(plugin, mode);
		return Array.isArray(jobs) ? jobs.length : 0;
	} catch {
		return 0;
	}
}

export async function regenerateAiSummariesAndEpochsForAllRecords(this: EpochPlugin): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	const summarizeAccess = hasSummarizeAIAccess(this);
	const generateAccess = hasGenerateEpochsAccess(this);
	if (!summarizeAccess && !generateAccess) {
		new Notice(`Epochgram ${"Pro"} required: AI summaries / ${"Generate Epochs"}`, 5000);
		return;
	}
	if (!Platform.isDesktopApp) {
		return;
	}
	try {
		await this.ensureIndexLoaded();
	} catch {
		// ignore
	}
	const epochsEnabled = isGenerateEpochsEffective(this);
	// Manual command: always allow regenerating AI summaries.
	if (summarizeAccess) await this.generateAiSummariesForAllRecords();
	if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
	if (epochsEnabled) {
		if (isSummarizeAIEffective(this)) {
			scheduleEpochRegenerationAfterAiIdle(this, "force", false);
			const planned = await getPlannedEpochJobCount(this, "force");
			if (planned > 0) new Notice(`Epochs: scheduled ${planned} job(s) (after AI finishes).`, 2500);
		} else {
			await this.regenerateEpochsForAllRecords();
		}
	}
}

export async function regenerateMissingAiSummariesAndEpochsForAllRecords(this: EpochPlugin): Promise<void> {
	const startCancelKey = getAiEnqueueCancelKey(this);
	const summarizeAccess = hasSummarizeAIAccess(this);
	const generateAccess = hasGenerateEpochsAccess(this);
	if (!summarizeAccess && !generateAccess) {
		new Notice(`Epochgram ${"Pro"} required: AI summaries / ${"Generate Epochs"}`, 5000);
		return;
	}
	if (!Platform.isDesktopApp) {
		return;
	}
	try {
		await this.ensureIndexLoaded();
	} catch {
		// ignore
	}
	const epochsEnabled = isGenerateEpochsEffective(this);
	const summariesEnabled = summarizeAccess && isSummarizeAIEffective(this);
	// Command behavior: respect the Auto summarize toggle.
	if (summariesEnabled) {
		await this.generateMissingAiSummariesForAllRecords();
	}
	if (getAiEnqueueCancelKey(this) !== startCancelKey) return;
	if (!epochsEnabled) return;
	if (summariesEnabled) {
		scheduleEpochRegenerationAfterAiIdle(this, "missing", true);
		const planned = await getPlannedEpochJobCount(this, "missing");
		if (planned > 0) new Notice(`Epochs: scheduled ${planned} missing job(s).`, 2500);
		return;
	}
	await this.regenerateMissingEpochsForAllRecords();
}
