import { describe, expect, it, vi } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { getEntriesForDate } from "../src/ui/entry-helpers";
import { computeTimelineSearchResultCountAllDates } from "../src/ui/epoch-view/search-count";
import { epochViewSetShowDraftsOnly } from "../src/ui/epoch-view/filters";
import { reviewSummaryFont, reviewSummaryOpacity } from "../src/ui/review-style";
import { getHoverFontStrForRow } from "../src/ui/summary-rendering/normal/hover-font";
import { computeDenseBarVisual } from "../src/ui/summary-rendering/dense";
import { addReviewActions } from "../src/ui/menus/summary-menu/entry-actions";
const key = "2026-01-01", day = new Date(2026, 0, 1);
const entry = (file: string, state?: DateEntry["reviewState"]): DateEntry => ({ date: key, file, summary: "Body", source: "cdate", blockStart: 0, blockEnd: 0, reviewState: state });
const canvas = (): any => ({ index: { [key]: [entry("draft.md"), entry("reviewed.md", "reviewed"), entry("hidden.md", "hidden")] }, showAttachments: true, showContentDates: true, showPropDates: true, searchQuery: "", plugin: {} });
describe("review UI", () => {
	it("hides Hidden by default and applies Drafts only", () => {
		const c = canvas(); expect(getEntriesForDate(c, day).map(e => e.file)).toEqual(["draft.md", "reviewed.md"]);
		c.showDraftsOnly = true; expect(getEntriesForDate(c, day).map(e => e.file)).toEqual(["draft.md"]);
	});
	it.each(["$hidden", "!hidden", "$HIDDEN"])("%s overrides Drafts only and counts Hidden records", token => {
		const c = canvas(); c.showDraftsOnly = true; c.searchQuery = token;
		expect(getEntriesForDate(c, day).map(e => e.file)).toEqual(["hidden.md"]);
		expect(computeTimelineSearchResultCountAllDates(c, token, { key: null, value: null })).toBe(1);
	});
	it("filters before collapsing multiple records from one file", () => {
		const c = canvas(); c.index[key] = [entry("note.md", "hidden"), { ...entry("note.md"), source: "content" }];
		expect(getEntriesForDate(c, day)[0].source).toBe("content");
	});
	it("invalidates count caches when switching Drafts only", () => {
		const c = canvas(), cache = { key: null, value: null };
		expect(computeTimelineSearchResultCountAllDates(c, "", cache)).toBe(2);
		c.showDraftsOnly = true; expect(computeTimelineSearchResultCountAllDates(c, "", cache)).toBe(1);
	});
	it("keeps the review filter session-only and synchronizes views", () => {
		const v: any = { showAttachments: true, showContentDates: true, plugin: { settings: { timelineFilters: {} }, saveSettings: vi.fn(), refreshEpochViews: vi.fn() }, canvas: { setShowDraftsOnly: vi.fn() } };
		epochViewSetShowDraftsOnly(v, true);
		expect(v.canvas.setShowDraftsOnly).toHaveBeenCalledWith(true); expect(v.plugin.viewPreferences.showDraftsOnly).toBe(true);
		expect(v.plugin.saveSettings).not.toHaveBeenCalled(); expect(v.plugin.refreshEpochViews).toHaveBeenCalledOnce();
	});
	it("styles Draft text and hover fonts italic and Hidden records faded", () => {
		expect(reviewSummaryFont(entry("d.md"), "700 14px sans-serif")).toBe("italic 700 14px sans-serif");
		expect(reviewSummaryFont(entry("r.md", "reviewed"), "14px sans-serif")).toBe("14px sans-serif");
		expect(getHoverFontStrForRow({ summaryFont: "italic 14px sans-serif", needsBoldFont: false }, "18px sans-serif")).toBe("italic 18px sans-serif");
		expect(reviewSummaryOpacity(entry("h.md", "hidden"))).toBe(0.38);
		const visual = computeDenseBarVisual({ entries: [entry("h.md", "hidden")], dayIndex: 0, xStart: 0, centerY: 0, availableWidth: 100, colTextBase: "black", colHighlight: "red", colRelated: "blue", activeFilePath: null });
		expect(visual?.opacity).toBe(0.38);
	});
	it("record menus use the selected record state, not a file-level state", async () => {
		const actions: any[] = [], p = { setEntryReview: vi.fn(async () => {}) };
		const menu: any = { addItem(fn: any) { const item: any = { setTitle(title: string) { this.title = title; return this; }, setIcon() { return this; }, setDisabled(disabled: boolean) { this.disabled = disabled; return this; }, onClick(fn: any) { this.click = fn; return this; } }; fn(item); actions.push(item); } };
		const selected = entry("note.md", "hidden"), s: any = { plugin: p, clearHover: vi.fn(), refreshIndex: vi.fn() };
		addReviewActions(menu, s, selected);
		expect(actions.map(a => a.title)).toEqual(["Review", "Draft", "Unhide"]);
		await actions[2].click(); expect(p.setEntryReview).toHaveBeenCalledWith(selected, "draft");
	});
});
