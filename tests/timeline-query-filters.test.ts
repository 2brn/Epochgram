import { describe, expect, it } from "vitest";
import { getEntriesForDate, getEntriesCountForDateFast } from "../src/ui/entry-helpers";
const date = new Date(2026, 0, 4), key = "2026-01-04";
const entry = (file: string, props: Record<string, unknown> = {}) => ({ date: key, file, blockStart: 0, blockEnd: 0, summary: "", source: "content", ...props });
function canvas(overrides: any = {}): any { return { index: { [key]: [entry("A.md"), entry("B.md"), entry("C.md")] }, showAttachments: true, showContentDates: true, showPropDates: false, searchQuery: "", plugin: {}, ...overrides }; }
describe("timeline query filters", () => {
	it("filters marks, not literal marked text, in both entries and fast counts", () => {
		const c = canvas({ searchQuery: "$marked", index: { [key]: [entry("A.md", { markColor: 2 }), entry("B.md", { summary: "marked" })] } });
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["A.md"]); expect(getEntriesCountForDateFast(c, date)).toBe(1);
	});
	it("excludes attachments when off", () => {
		const c = canvas({ showAttachments: false, index: { [key]: [entry("img.png"), entry("A.md")] } });
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["A.md"]);
	});
	it("excludes content dates but retains anchors when parsed dates are off", () => {
		const c = canvas({ showContentDates: false, index: { [key]: [entry("A.md"), entry("B.md", { source: "cdate" })] } });
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["B.md"]);
	});
	it("nests frontmatter dates under parsed dates", () => {
		const c = canvas({ index: { [key]: [entry("A.md", { fromFrontmatter: true }), entry("B.md")] } });
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["B.md"]);
		c.showPropDates = true; expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["A.md", "B.md"]);
		c.showContentDates = false; expect(getEntriesForDate(c, date)).toEqual([]);
	});
	it("restricts to related files and refreshes when the active file changes", () => {
		const c = canvas({ searchQuery: "$similar", activeFilePath: "A.md", relatedPaths: new Set(["A.md", "B.md"]), relatedRequestId: 1 });
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["A.md", "B.md"]);
		expect(getEntriesCountForDateFast(c, date)).toBe(2);
		c.activeFilePath = "C.md"; c.relatedPaths = new Set(["C.md"]); c.relatedRequestId++;
		expect(getEntriesForDate(c, date).map(e => e.file)).toEqual(["C.md"]); expect(getEntriesCountForDateFast(c, date)).toBe(1);
	});
	it("excludes days outside the search date range", () => {
		const c = canvas({ searchQuery: "2026-01-05..2026-01-05" });
		expect(getEntriesForDate(c, date)).toEqual([]); expect(getEntriesCountForDateFast(c, date)).toBe(0);
	});
});
