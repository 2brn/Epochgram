import type { EpochBucket } from "../../indexer/types";
import type { EpochPlugin } from "../../main";
import type { BridgeEpochRule, BridgeResolvedSettings } from "../ai-bridge/sanitize";
import { validateBridgeOptionsYaml } from "../ai-bridge/sanitize";

const PERIOD_ORDER = ["day", "2days", "4days", "week", "2weeks", "month", "3months", "6months", "year"] as const;

function requirePositiveInteger(value: unknown, key: string): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		const normalized = Math.floor(value);
		if (normalized > 0) return normalized;
	}
	throw new Error(`Bridge settings missing valid ${key}`);
}

function getStoredResolvedBridgeSettings(plugin: EpochPlugin): BridgeResolvedSettings {
	const raw = plugin.settings?.aiBridgeOptions;
	if (raw && typeof raw === "object") {
		const rawObj = raw as { settingsYaml?: unknown; resolved?: unknown };
		if (typeof rawObj.settingsYaml === "string") {
			return validateBridgeOptionsYaml(rawObj.settingsYaml).resolved;
		}
		const resolved = rawObj.resolved;
		if (resolved && typeof resolved === "object") {
			return resolved as unknown as BridgeResolvedSettings;
		}
	}
	return validateBridgeOptionsYaml("").resolved;
}

function periodCoversBucket(period: string, bucket: EpochBucket): boolean {
	const normalizedPeriod = String(period || "").trim().toLowerCase();
	const bucketIndex = PERIOD_ORDER.indexOf(bucket);
	if (bucketIndex < 0 || !normalizedPeriod) return false;
	if (!normalizedPeriod.includes("-")) return normalizedPeriod === bucket;
	const [start, end] = normalizedPeriod.split("-");
	const startIndex = PERIOD_ORDER.indexOf(start as typeof PERIOD_ORDER[number]);
	const endIndex = PERIOD_ORDER.indexOf(end as typeof PERIOD_ORDER[number]);
	if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return false;
	return bucketIndex >= startIndex && bucketIndex <= endIndex;
}

function getEpochRuleForBucket(resolved: BridgeResolvedSettings, bucket: EpochBucket): BridgeEpochRule | null {
	const rules = Array.isArray(resolved.epochs) ? resolved.epochs : [];
	for (const rule of rules) {
		if (!rule || typeof rule !== "object") continue;
		if (periodCoversBucket(String(rule.period || ""), bucket)) return rule;
	}
	return null;
}

export type AiSummaryTuning = {
	recordsMaxInputChars: number;
	maxRelatedChars: number;
	reduceMaxDepth: number;
	maxChunkChars: number;
	getEpochMaxFileChars(bucket: EpochBucket): number;
};

export function getAiSummaryTuning(plugin: EpochPlugin): AiSummaryTuning {
	const resolved = getStoredResolvedBridgeSettings(plugin);
	return {
		recordsMaxInputChars: requirePositiveInteger(resolved.records?.maxInputChars, "records.maxInputChars"),
		maxRelatedChars: requirePositiveInteger(resolved.maxRelatedChars, "maxRelatedChars"),
		reduceMaxDepth: requirePositiveInteger(resolved.reduce?.maxDepth, "reduce.maxDepth"),
		maxChunkChars: requirePositiveInteger(resolved.reduce?.maxChunkChars, "reduce.maxChunkChars"),
		getEpochMaxFileChars(bucket: EpochBucket): number {
			const rule = getEpochRuleForBucket(resolved, bucket);
			const value = rule?.maxFileChars;
			return value == null ? 0 : requirePositiveInteger(value, `epochs(${bucket}).maxFileChars`);
		}
	};
}