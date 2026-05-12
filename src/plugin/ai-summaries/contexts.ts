import type { EpochBucket, FileDateEntry } from "../../indexer/types";
import {
	DEFAULT_EPOCH_CONTEXT_TEMPLATE,
	DEFAULT_SUMMARY_CONTEXT_TEMPLATE,
	renderAiContextTemplate
} from "../ai-context-templates";

function redactDatesFromPromptText(text: string): string {
	const raw = String(text ?? "");
	if (!raw) return "";
	return raw
		.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
		.replace(/\b\d{4}\/\d{2}\/\d{2}\b/g, "[date]")
		.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[date]")
		.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "[timestamp]");
}

export function buildEpochContext(bucket: EpochBucket, start: string, end: string): string {
	return renderAiContextTemplate(DEFAULT_EPOCH_CONTEXT_TEMPLATE, {
		filePath: "",
		bucket,
		start,
		end,
		related: ""
	});
}

export function buildEpochReduceContext(bucket: EpochBucket, start: string, end: string): string {
	return renderAiContextTemplate(DEFAULT_EPOCH_CONTEXT_TEMPLATE, {
		filePath: "",
		bucket,
		start,
		end,
		related: ""
	});
}

export function buildPerCallContext(filePath: string, entry: FileDateEntry, related: string = ""): string {
	return renderAiContextTemplate(DEFAULT_SUMMARY_CONTEXT_TEMPLATE, {
		filePath: redactDatesFromPromptText(filePath),
		date: entry?.date ?? "",
		related
	});
}

export function buildReduceContext(filePath: string, entry: FileDateEntry, depth: number, related: string = ""): string {
	return renderAiContextTemplate(DEFAULT_SUMMARY_CONTEXT_TEMPLATE, {
		filePath: redactDatesFromPromptText(filePath),
		date: entry?.date ?? "",
		related
	});
}
