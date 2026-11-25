import type { DateEntry } from "../indexer/types";
import { isEntryDraft, isEntryHidden } from "../indexer/review-state";
export const SUMMARY_HIDDEN_ALPHA = 0.38;
export function reviewSummaryFont(entry: DateEntry, font: string): string {
	return isEntryDraft(entry) && !/^italic\b/.test(font) ? `italic ${font}` : font;
}
export function reviewSummaryOpacity(entry: DateEntry): number { return isEntryHidden(entry) ? SUMMARY_HIDDEN_ALPHA : 1; }
