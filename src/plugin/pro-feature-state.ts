import { Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { DEFAULT_SETTINGS } from "../settings-model";
import { hasTrustedActivationState, hasVerifiedFeatureAccess } from "./pro-trust";

export function hasVerifiedEntitlement(plugin: EpochPlugin): boolean {
	try {
		if (!hasTrustedActivationState(plugin)) return false;
		return plugin.proActive === true;
	} catch {
		return false;
	}
}

export function hasTrackChangesAccess(plugin: EpochPlugin): boolean {
	return hasVerifiedEntitlement(plugin) && hasVerifiedFeatureAccess(plugin, "trackChanges");
}

export function hasRecurringAccess(plugin: EpochPlugin): boolean {
	return hasVerifiedEntitlement(plugin) && hasVerifiedFeatureAccess(plugin, "recurring");
}

export function hasAiBridgeAccess(plugin: EpochPlugin): boolean {
	return Platform.isDesktop && hasVerifiedEntitlement(plugin) && hasVerifiedFeatureAccess(plugin, "aiBridge");
}

export function hasSummarizeAIAccess(plugin: EpochPlugin): boolean {
	return hasAiBridgeAccess(plugin) && hasVerifiedFeatureAccess(plugin, "summarizeAI");
}

export function hasGenerateEpochsAccess(plugin: EpochPlugin): boolean {
	return hasAiBridgeAccess(plugin) && hasVerifiedFeatureAccess(plugin, "generateEpochs");
}

export function hasSimilarityAccess(plugin: EpochPlugin): boolean {
	return hasVerifiedEntitlement(plugin) && hasVerifiedFeatureAccess(plugin, "similarity");
}

export function isTrackChangesConfigured(plugin: EpochPlugin): boolean {
	return plugin.settings.trackChanges === true;
}

export function isTrackChangesEffective(plugin: EpochPlugin): boolean {
	return hasTrackChangesAccess(plugin) && isTrackChangesConfigured(plugin);
}

export function isSummarizeAIEffective(plugin: EpochPlugin): boolean {
	return hasSummarizeAIAccess(plugin) && plugin.settings.summarizeAI === true;
}

export function isGenerateEpochsEffective(plugin: EpochPlugin): boolean {
	return hasGenerateEpochsAccess(plugin) && plugin.settings.generateEpochs === true;
}

export function isOpenAiBridgeOnStartupEffective(plugin: EpochPlugin): boolean {
	return hasAiBridgeAccess(plugin) && plugin.settings.openAiBridgeOnStartup === true;
}

export function getEffectiveSimilarityThreshold(plugin: EpochPlugin): number {
	if (!hasSimilarityAccess(plugin)) return 0;
	const raw = Number(plugin.settings.similarityThreshold);
	if (!Number.isFinite(raw)) return 0;
	return raw > 0 && raw < 1 ? raw : 0;
}

export function getEffectiveZeroShotMinScore(plugin: EpochPlugin): number {
	if (!hasSimilarityAccess(plugin)) return 0;
	const raw = Number(plugin.settings.similarityZeroShotMinScore ?? 0);
	const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
	return clamped > 0 && clamped < 1 ? clamped : 0;
}

export function getEffectiveSimilarityUseLinks(plugin: EpochPlugin): boolean {
	return hasSimilarityAccess(plugin) && plugin.settings.similarityUseLinks !== false;
}

export function getEffectiveSimilarityUseTags(plugin: EpochPlugin): boolean {
	return hasSimilarityAccess(plugin) && plugin.settings.similarityUseTags !== false;
}

export function getEffectiveTitleSimilarityThreshold(plugin: EpochPlugin): number {
	if (!hasSimilarityAccess(plugin)) return 0;
	const raw = Number(plugin.settings.similarityTitleJwThreshold);
	if (!Number.isFinite(raw)) return Number(DEFAULT_SETTINGS.similarityTitleJwThreshold);
	return Math.max(0, Math.min(1, raw));
}