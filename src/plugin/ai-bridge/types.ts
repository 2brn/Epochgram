import type { EpochBucket } from "../../indexer/types";

export interface AiSummaryJob {
	targets?: {
		kind: "cdate" | "namedDate" | "dateProp" | "content" | "tracked";
		date: string;
		blockStart: number;
		blockEnd: number;
		source: string;
	}[];
	groupType?: "anchor" | "content" | "tracked";
	groupDate?: string;
	id: string;
	groupId?: string;
	chunkIndex?: number;
	chunkCount?: number;
	filePath: string;
	kind: "cdate" | "namedDate" | "dateProp" | "content" | "tracked" | "epoch";
	date: string;
	blockStart: number;
	blockEnd: number;
	source: string;
	input: string;
	context: string;
	related?: string;
	reduce?: boolean;
	reduceDepth?: number;
	inputHash: string;
	createdAt: number;
	epochBucket?: EpochBucket;
	epochStart?: string;
	epochEnd?: string;
}

export interface AiSummaryJobResult {
	id: string;
	summary?: string;
	error?: string;
	outputChars?: number;
}

export interface AiBridgeStatus {
	clientConnected: boolean;
	queued: number;
	inProgress: number;
	done: number;
	errors: number;
	queuedTokens: number;
	inProgressTokens: number;
	processedTokens: number;
	errorTokens: number;
	lastError: string | null;
	// Optional epoch hierarchy progress. Present when epoch generation is running or scheduled.
	epochTotal?: number;
	epochProcessed?: number;
	epochRemaining?: number;
	epochTotalTokens?: number;
	epochQueuedTokens?: number;
	epochInProgressTokens?: number;
	epochProcessedTokens?: number;
	epochRemainingTokens?: number;
}
