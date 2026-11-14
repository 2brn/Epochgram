import type { EpochBucket, FileDateEntry } from "../../indexer/types";
import { renderAiContextTemplate } from "../ai-context-templates";
import { getDefaultBridgeSettings, getEpochRuleForBucket } from "./bridge-settings";

function redactDatesFromPromptText(text: string): string {
	const raw = String(text ?? "");
	if (!raw) return "";
	return raw
		.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
		.replace(/\b\d{4}\/\d{2}\/\d{2}\b/g, "[date]")
		.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[date]")
		.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "[timestamp]");
}

export function buildEpochContext(bucket: EpochBucket, start: string, end: string, related: string = ""): string {
	const template = getEpochRuleForBucket(getDefaultBridgeSettings(), bucket)?.context ?? "";
	return renderAiContextTemplate(template, { related }).trim();
}

export function buildEpochReduceContext(bucket: EpochBucket, start: string, end: string, related: string = ""): string {
	return buildEpochContext(bucket, start, end, related);
}

export function buildIntermediateReduceContext(): string {
	return String(getDefaultBridgeSettings().reduce?.context ?? "").trim();
}

export function buildPerCallContext(filePath: string, entry: FileDateEntry, related: string = ""): string {
	const path = redactDatesFromPromptText(filePath);
	const fileName = (path.split(/[\\/]/).pop() || path).replace(/\.md$/i, "");
	return renderAiContextTemplate(getDefaultBridgeSettings().records?.context ?? "", {
		filePath: path,
		fileName,
		related
	}).trim();
}

export function buildReduceContext(filePath: string, entry: FileDateEntry, depth: number, related: string = ""): string {
	return buildPerCallContext(filePath, entry, related);
}
