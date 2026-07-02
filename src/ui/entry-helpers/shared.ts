import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry, EpochIndex } from "../../indexer/types";
import { normalizeMarkColorIndex } from "../mark-colors";
import { parseTimelineQuery, type TimelineQuery } from "../timeline-search";

export interface EntryState {
	index: EpochIndex;
	showAttachments: boolean;
	showTrackedChanges: boolean;
	showHidden: boolean;
	showDraftOnly: boolean;
	showContentDates: boolean;
	showPropDates: boolean;
	epochsView: boolean;
	searchQuery: string;
	semanticRelatedBasePath?: string;
	activeFilePath?: string | null;
	semanticRelatedPaths?: Set<string>;
	semanticRelatedTermPaths?: Set<string>;
	semanticRelatedRequestId?: number;
	semanticRelatedTermLastUpdatedAt?: number;
	plugin?: {
		__epochInheritedMarkIndexByPath?: Map<string, number>;
		__epochInheritedMarkComputedAt?: number;
	};
}

type DateEntryWithExtras = DateEntry & {
	fromFrontmatter?: boolean;
};

export function state(canvas: EpochCanvas): EntryState {
	return canvas as unknown as EntryState;
}

const PARSED_TIMELINE_QUERY_BY_CANVAS = new WeakMap<object, { raw: string; parsed: TimelineQuery }>();

export function getParsedTimelineQuery(canvas: EpochCanvas): TimelineQuery {
	const raw = String(state(canvas).searchQuery ?? "");
	const key = raw;
	try {
		const prev = PARSED_TIMELINE_QUERY_BY_CANVAS.get(canvas);
		if (prev && prev.raw === key) return prev.parsed;
	} catch {
		// ignore
	}
	const parsed = parseTimelineQuery(key);
	try {
		PARSED_TIMELINE_QUERY_BY_CANVAS.set(canvas, { raw: key, parsed });
	} catch {
		// ignore
	}
	return parsed;
}

export function computeEffectiveFilters(
	canvas: EpochCanvas,
	s: EntryState,
	parsed: TimelineQuery
): {
	showAttachments: boolean;
	showTrackedChanges: boolean;
	showHidden: boolean;
	hiddenOnly: boolean;
	showDraftOnly: boolean;
	showContentDates: boolean;
	showPropDates: boolean;
} {
	void canvas;
	const tokens = (() => {
		try {
			return String(parsed?.fuzzyText || "")
				.split(/\s+/g)
				.map((token) => String(token || "").trim().toLowerCase())
				.filter(Boolean);
		} catch {
			return [];
		}
	})();
	const hasHiddenToken = tokens.includes("!hidden") || tokens.includes("$hidden");
	return {
		showAttachments: !!s.showAttachments,
		showTrackedChanges: !!s.showTrackedChanges,
		showHidden: !!s.showHidden || hasHiddenToken,
		hiddenOnly: hasHiddenToken,
		showDraftOnly: !!s.showDraftOnly,
		showContentDates: !!s.showContentDates,
		showPropDates: !!s.showPropDates
	};
}

export function hasSimilarOnlyToken(parsed: TimelineQuery): boolean {
	try {
		const tokens = String(parsed?.fuzzyText || "")
			.split(/\s+/g)
			.map((token) => String(token || "").trim().toLowerCase())
			.filter(Boolean);
		return tokens.includes("!similar") || tokens.includes("$similar");
	} catch {
		return false;
	}
}

export function hasCurrentOnlyToken(parsed: TimelineQuery): boolean {
	try {
		const tokens = String(parsed?.fuzzyText || "")
			.split(/\s+/g)
			.map((token) => String(token || "").trim().toLowerCase())
			.filter(Boolean);
		return tokens.includes("!current") || tokens.includes("$current");
	} catch {
		return false;
	}
}

export function hasHiddenOnlyToken(parsed: TimelineQuery): boolean {
	try {
		const tokens = String(parsed?.fuzzyText || "")
			.split(/\s+/g)
			.map((token) => String(token || "").trim().toLowerCase())
			.filter(Boolean);
		return tokens.includes("!hidden") || tokens.includes("$hidden");
	} catch {
		return false;
	}
}

export function getSimilarScopeSignature(canvas: EpochCanvas, parsed: TimelineQuery): string {
	if (!hasSimilarOnlyToken(parsed) && !hasCurrentOnlyToken(parsed)) return "";
	try {
		const c = state(canvas);
		const basePath = String(c.semanticRelatedBasePath ?? c.activeFilePath ?? "").trim();
		const relatedSize = c.semanticRelatedPaths instanceof Set ? c.semanticRelatedPaths.size : 0;
		const termRelatedSize = c.semanticRelatedTermPaths instanceof Set ? c.semanticRelatedTermPaths.size : 0;
		const semanticReqId = Number(c.semanticRelatedRequestId ?? 0);
		const termUpdatedAt = Number(c.semanticRelatedTermLastUpdatedAt ?? 0);
		return [
			`SIMP:${basePath}`,
			`SIMR:${relatedSize}`,
			`SIMT:${termRelatedSize}`,
			`SIMQ:${Number.isFinite(semanticReqId) ? semanticReqId : 0}`,
			`SIMU:${Number.isFinite(termUpdatedAt) ? termUpdatedAt : 0}`
		].join("|");
	} catch {
		return "SIMERR";
	}
}

export function isPropDateEntry(entry: DateEntry): boolean {
	return (entry as DateEntryWithExtras).fromFrontmatter === true;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
	return DATE_KEY_RE.test(String(value || ""));
}

export function isDateWithinRange(dateKey: string, range: { start: string; end: string } | null): boolean {
	if (!range) return true;
	const key = String(dateKey || "");
	if (!isDateKey(key)) return false;
	return key >= range.start && key <= range.end;
}

export function dateKeyToUtcMs(key: string): number {
	if (!isDateKey(key)) return Number.NaN;
	const [yyRaw, mmRaw, ddRaw] = key.split("-");
	const yy = Number(yyRaw);
	const mm = Number(mmRaw);
	const dd = Number(ddRaw);
	if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return Number.NaN;
	return Date.UTC(yy, mm - 1, dd);
}

export function getInheritedMarkIndexByPath(canvas: EpochCanvas): Map<string, number> | null {
	try {
		const pluginState = state(canvas).plugin;
		const map = pluginState?.__epochInheritedMarkIndexByPath;
		return map && typeof map.get === "function" ? map : null;
	} catch {
		return null;
	}
}

export function getInheritedMarkComputedAt(canvas: EpochCanvas): number {
	try {
		const raw = Number(state(canvas).plugin?.__epochInheritedMarkComputedAt ?? 0);
		return Number.isFinite(raw) ? raw : 0;
	} catch {
		return 0;
	}
}

export function isColorMarked(entry: DateEntry, inheritedMarkIndexByPath: Map<string, number> | null): boolean {
	if (normalizeMarkColorIndex(entry.markColor)) return true;
	if (inheritedMarkIndexByPath && typeof entry.file === "string" && entry.file) {
		return normalizeMarkColorIndex(inheritedMarkIndexByPath.get(entry.file)) != null;
	}
	return false;
}

export function isAttachmentEntry(entry: DateEntry | null | undefined): boolean {
	if (!entry) return false;
	const file = String(entry.file ?? "");
	if (file.startsWith("epoch://")) return false;
	if (/\.md$/i.test(file)) return false;
	return true;
}
