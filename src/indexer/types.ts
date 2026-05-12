export type DateSource = "cdate" | "namedate" | "dateprop" | "content" | "tracked" | "epoch";
export type TrackedChangeType = "added" | "removed" | "modified";

export type RecurrenceKind = "friendly" | "rrule";

export interface RecurrenceIndexData {
	/** Raw value from YAML frontmatter `recur:`. */
	raw: string;
	/** 0-based line index for the `recur:` row when known (best-effort). */
	line: number;
	/** Normalized dtstart date key (YYYY-MM-DD) when known. */
	from?: string;
	/** Normalized inclusive end date key (YYYY-MM-DD) when known. */
	until?: string;
	/** Optional count limit (occurrences). */
	count?: number;
	/** Normalized RRULE string (no DTSTART/UNTIL prefix lines). */
	rrule: string;
	kind: RecurrenceKind;
}

export type ReviewState = "draft" | "reviewed" | "hidden";
export type FileReviewState = Exclude<ReviewState, "hidden">;

export const EPOCH_BUCKETS = ["day", "2days", "4days", "week", "2weeks", "month", "3months", "6months", "year"] as const;

export type EpochBucket = (typeof EPOCH_BUCKETS)[number];

// Heuristic day-span used for UI/zoom decisions and coarse scan windows.
const EPOCH_BUCKET_ROUGH_DAYS: Readonly<Record<EpochBucket, number>> = {
	day: 1,
	"2days": 2,
	"4days": 4,
	week: 7,
	"2weeks": 14,
	month: 30,
	"3months": 90,
	"6months": 180,
	year: 365
} as const;

export function epochBucketRoughDays(bucket: EpochBucket): number {
	return EPOCH_BUCKET_ROUGH_DAYS[bucket] ?? 1;
}

export function isEpochBucket(value: string): value is EpochBucket {
    return (EPOCH_BUCKETS as unknown as string[]).includes(value);
}

export interface DateEntry {
    date: string;
    originalDate?: string;
    file: string;
    blockStart: number;
    blockEnd: number;
    summary: string;
    aiSummary?: string;
    aiSummaryInputHash?: string;
	aiSummaryVisible?: boolean;
    source: DateSource;
	/** True when a content-date was derived from parsed YAML frontmatter (not body text). */
	fromFrontmatter?: boolean;
	/** True for synthetic recurring occurrences derived from frontmatter `recur:`. */
	recurring?: boolean;
	epochBucket?: EpochBucket;
	epochStart?: string;
	epochEnd?: string;
	reviewState?: ReviewState;
	markColor?: number;
    pinned?: boolean;
    trackedChange?: TrackedChangeType;
    trackedTime?: string;
    trackedHash?: string;
}

export type FileDateEntry = DateEntry;

export interface FileIndexData {
    cdate: FileDateEntry | null;
    namedDate: FileDateEntry | null;
	dateProp: FileDateEntry | null;
    contentDates: FileDateEntry[];
	/** When true (frontmatter `noparsed:` present), parsed/content-derived date entries are suppressed for this file. */
	noparsed?: boolean;
    trackedDates: Record<string, FileDateEntry[]>;
	/** When true (frontmatter `notracked:` present), tracked-change date entries are suppressed for this file. */
	notracked?: boolean;
    trackedSnapshot: string | null;
    trackedSnapshotDate: string | null;
    trackedBaselineSnapshot: string | null;
    trackedBaselineDate: string | null;
	/** Last observed vault stat.mtime when this file was indexed (ms since epoch). */
	indexedMtimeMs?: number;
	/** Last observed vault stat.size when this file was indexed (bytes). */
	indexedSize?: number;
	/** Normalized content hash (CRLF->LF) used to detect no-op modifies (e.g., Sync touches). */
	contentHash?: string;
	/** Optional user-provided term used as the embedding input for Similarity (Pro). */
	embeddingTerm?: string;
	markColor?: number;
    pinnedFile?: boolean;
	/** Optional recurring schedule derived from YAML frontmatter `recur:`. */
	recur?: RecurrenceIndexData | null;
	/**
	 * Per-file hidden overrides for synthetic recurring occurrences.
	 * Stores date keys (YYYY-MM-DD) that should render with `reviewState: "hidden"` when emitted.
	 */
	recurHiddenDates?: string[];
	/**
	 * Per-file reviewed overrides for synthetic recurring occurrences.
	 * Stores date keys (YYYY-MM-DD) that should render with `reviewState: "reviewed"` when emitted.
	 */
	recurReviewedDates?: string[];
}

export type StoredFileIndexData = FileIndexData;

export interface SerializedEpochIndex {
    files: Record<string, StoredFileIndexData>;
    dates: EpochIndex;
}

export type EpochIndex = Record<string, DateEntry[]>;