export type DateSource = "cdate" | "namedate" | "dateprop" | "content";
export function isDateSource(value: unknown): value is DateSource {
	return value === "cdate" || value === "namedate" || value === "dateprop" || value === "content";
}
export type RecurrenceKind = "friendly" | "rrule";
export type ReviewState = "draft" | "reviewed" | "hidden";
export type FileReviewState = Exclude<ReviewState, "hidden">;
export interface ReviewMutation { state: ReviewState; updatedAt: number; }
export const PIN_MODES = ["today", "date", "dock"] as const;
export type PinMode = (typeof PIN_MODES)[number];

export function normalizePinMode(value: unknown): PinMode | null {
	if (value === true) return "today";
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	return normalized === "today" || normalized === "date" || normalized === "dock" ? normalized : null;
}
export function hasPinMode(value: unknown): value is PinMode { return normalizePinMode(value) !== null; }
export function isTodayPinMode(value: unknown): boolean { return normalizePinMode(value) === "today"; }

export interface RecurrenceIndexData {
	raw: string;
	line: number;
	from?: string;
	until?: string;
	count?: number;
	rrule: string;
	kind: RecurrenceKind;
}

export interface DateEntry {
	date: string;
	originalDate?: string;
	file: string;
	blockStart: number;
	blockEnd: number;
	summary: string;
	source: DateSource;
	fromFrontmatter?: boolean;
	namedDateRange?: boolean;
	recurring?: boolean;
	icsSynced?: boolean;
	markColor?: number;
	markColorHex?: string;
	pinned?: boolean;
	fileMtimeMs?: number;
	reviewState?: ReviewState;
	reviewStateUpdatedAt?: number;
}
export type FileDateEntry = DateEntry;

export interface FileIndexData {
	cdate: FileDateEntry | null;
	namedDate: FileDateEntry | null;
	dateProp: FileDateEntry | null;
	contentDates: FileDateEntry[];
	noparsed?: boolean;
	anchorUsesMdate?: boolean;
	indexedMtimeMs?: number;
	indexedSize?: number;
	contentHash?: string;
	bodyHash?: string;
	markColor?: number;
	markColorHex?: string;
	pinnedFile?: PinMode | null;
	recur?: RecurrenceIndexData | null;
	recurringReviewStates?: Record<string, ReviewMutation>;
}
export type StoredFileIndexData = FileIndexData;
export interface SerializedEpochIndex {
	files: Record<string, StoredFileIndexData>;
	dates: EpochIndex;
}
export type EpochIndex = Record<string, DateEntry[]>;
