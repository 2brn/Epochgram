import type { EpochBucket, FileDateEntry } from "../../indexer/types";

export interface AiSummariesMethods {
	maybePromptEnableSummarizeAIOnProActivation(): Promise<void>;
	enableSummarizeAIFlow(): Promise<void>;
	maybeOpenAiBridgeOnStartup(): Promise<void>;
	openAiBridgeWindow(options?: { silent?: boolean; source?: "command" | "maintenance" | "auto" | "other"; forceOpen?: boolean }): Promise<void>;
	ensureAiSummarizerReadyWithProgress(): Promise<void>;
	enqueueAiSummariesForFile(filePath: string, options?: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean }): Promise<void>;
	enqueueAiSummaryForEntry(entry: FileDateEntry, options?: { force?: boolean; showNotice?: boolean; enableIfDisabled?: boolean }): Promise<void>;
	enqueueEpochsForDateKeys(dateKeys: string[], options?: { force?: boolean; showNotice?: boolean; buckets?: EpochBucket[] }): Promise<void>;
	regenerateAiSummariesAndEpochsForAllRecords(): Promise<void>;
	regenerateMissingAiSummariesAndEpochsForAllRecords(): Promise<void>;
	generateAiSummariesForAllRecords(): Promise<void>;
	generateMissingAiSummariesForAllRecords(): Promise<void>;
	generateEpochsForAllRecords(): Promise<void>;
	regenerateEpochsForAllRecords(): Promise<void>;
	regenerateMissingEpochsForAllRecords(): Promise<void>;
	stopAiBridge(): Promise<void>;
	onAiBridgeOptionsChanged(prev: Record<string, any>, next: Record<string, any>): void;
}

import {
	maybePromptEnableSummarizeAIOnProActivation,
	enableSummarizeAIFlow,
	maybeOpenAiBridgeOnStartup,
	openAiBridgeWindow,
	ensureAiSummarizerReadyWithProgress,
	stopAiBridge,
	onAiBridgeOptionsChanged
} from "./methods-bridge";
import {
	enqueueAiSummariesForFile,
	enqueueAiSummaryForEntry,
	generateAiSummariesForAllRecords,
	generateMissingAiSummariesForAllRecords
} from "./methods-summaries";
import {
	enqueueEpochsForDateKeys,
	generateEpochsForAllRecords,
	regenerateEpochsForAllRecords,
	regenerateMissingEpochsForAllRecords
} from "./methods-epochs";
import {
	regenerateAiSummariesAndEpochsForAllRecords,
	regenerateMissingAiSummariesAndEpochsForAllRecords
} from "./methods-regenerate";

export const aiSummariesMethods: AiSummariesMethods = {
	maybePromptEnableSummarizeAIOnProActivation,
	enableSummarizeAIFlow,
	maybeOpenAiBridgeOnStartup,
	openAiBridgeWindow,
	ensureAiSummarizerReadyWithProgress,
	enqueueAiSummariesForFile,
	enqueueAiSummaryForEntry,
	enqueueEpochsForDateKeys,
	regenerateAiSummariesAndEpochsForAllRecords,
	regenerateMissingAiSummariesAndEpochsForAllRecords,
	generateAiSummariesForAllRecords,
	generateMissingAiSummariesForAllRecords,
	generateEpochsForAllRecords,
	regenerateEpochsForAllRecords,
	regenerateMissingEpochsForAllRecords,
	stopAiBridge,
	onAiBridgeOptionsChanged
};
