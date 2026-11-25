import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry, EpochIndex } from "../../indexer/types";
import { isEntryDraft, isEntryHidden } from "../../indexer/review-state";
import { normalizeMarkColorIndex } from "../mark-colors";
import { parseTimelineQuery, type TimelineQuery } from "../timeline-search";
export interface EntryState {
	index: EpochIndex; showAttachments: boolean; showContentDates: boolean; showPropDates: boolean; showDraftsOnly?: boolean; searchQuery: string;
	relatedBasePath?: string; activeFilePath?: string | null; relatedPaths?: Set<string>; relatedRequestId?: number;
	plugin?: { __epochInheritedMarkIndexByPath?: Map<string, number>; __epochInheritedMarkComputedAt?: number };
}
export function state(canvas: EpochCanvas): EntryState { return canvas as unknown as EntryState; }
const parsedCache = new WeakMap<object, { raw: string; parsed: TimelineQuery }>();
export function getParsedTimelineQuery(canvas: EpochCanvas): TimelineQuery {
	const raw = String(state(canvas).searchQuery ?? "");
	const previous = parsedCache.get(canvas);
	if (previous?.raw === raw) return previous.parsed;
	const parsed = parseTimelineQuery(raw); parsedCache.set(canvas, { raw, parsed }); return parsed;
}
export function computeEffectiveFilters(_canvas: EpochCanvas, s: EntryState, _parsed: TimelineQuery): { showAttachments: boolean; showContentDates: boolean; showPropDates: boolean } {
	return { showAttachments: !!s.showAttachments, showContentDates: !!s.showContentDates, showPropDates: !!s.showPropDates };
}
function tokens(parsed: TimelineQuery): string[] { return parsed.fuzzyText.toLowerCase().split(/\s+/g); }
export function hasHiddenOnlyToken(parsed: TimelineQuery): boolean { return tokens(parsed).some(t => t === "$hidden" || t === "!hidden"); }
export function isReviewVisible(entry: DateEntry, draftsOnly: boolean, hiddenOnly: boolean): boolean {
	return hiddenOnly ? isEntryHidden(entry) : !isEntryHidden(entry) && (!draftsOnly || isEntryDraft(entry));
}
export function hasSimilarOnlyToken(parsed: TimelineQuery): boolean { return tokens(parsed).some(t => t === "$similar" || t === "!similar"); }
export function hasCurrentOnlyToken(parsed: TimelineQuery): boolean { return tokens(parsed).some(t => ["$current", "!current", "$same", "!same"].includes(t)); }
export function getSimilarScopeSignature(canvas: EpochCanvas, parsed: TimelineQuery): string {
	if (!hasSimilarOnlyToken(parsed) && !hasCurrentOnlyToken(parsed)) return "";
	const c = state(canvas);
	return [c.relatedBasePath ?? c.activeFilePath, c.relatedRequestId, ...(c.relatedPaths ?? [])].join("|");
}
export function isPropDateEntry(entry: DateEntry): boolean { return entry.fromFrontmatter === true; }
export function isDateKey(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
export function isDateWithinRange(key: string, range: { start: string; end: string } | null): boolean { return !range || isDateKey(key) && key >= range.start && key <= range.end; }
export function dateKeyToUtcMs(key: string): number { return isDateKey(key) ? Date.parse(`${key}T00:00:00Z`) : Number.NaN; }
export function getInheritedMarkIndexByPath(canvas: EpochCanvas): Map<string, number> | null { return state(canvas).plugin?.__epochInheritedMarkIndexByPath ?? null; }
export function getInheritedMarkComputedAt(canvas: EpochCanvas): number { return state(canvas).plugin?.__epochInheritedMarkComputedAt ?? 0; }
export function isColorMarked(entry: DateEntry, inherited: Map<string, number> | null): boolean { return normalizeMarkColorIndex(entry.markColor) != null || !!entry.markColorHex?.trim() || normalizeMarkColorIndex(inherited?.get(entry.file)) != null; }
export function isAttachmentEntry(entry: DateEntry | null | undefined): boolean { return !!entry && !/\.md$/i.test(entry.file); }
