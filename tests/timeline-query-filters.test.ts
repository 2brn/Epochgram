import { describe, expect, it } from "vitest";

import { getEntriesForDate, getEntriesCountForDateFast } from "../src/ui/entry-helpers";

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: false,
		showDraftOnly: false,
		showContentDates: true,
		showPropDates: false,
		epochsView: false,
		searchQuery: "",
		plugin: {}
	};
	return Object.assign(base, overrides);
}

describe("timeline query filters (no directives)", () => {
	it("!marked filters to marked entries", () => {
		const canvas = makeCanvas({
			searchQuery: "!marked",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", markColor: 2 },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.map(e => e.file)).toEqual(["A.md"]);
	});

	it("!marked does not match literal text", () => {
		const canvas = makeCanvas({
			searchQuery: "!marked",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", markColor: 2 },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "this is marked", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.map(e => e.file)).toEqual(["A.md"]);
	});

	it("!marked affects fast per-day counts", () => {
		const canvas = makeCanvas({
			searchQuery: "!marked",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", markColor: 2 },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				],
				"2026-01-05": [
					{ date: "2026-01-05", file: "C.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const c1 = getEntriesCountForDateFast(canvas as any, new Date("2026-01-04T00:00:00Z"));
		const c2 = getEntriesCountForDateFast(canvas as any, new Date("2026-01-05T00:00:00Z"));
		expect(c1).toBe(1);
		expect(c2).toBe(0);
	});

	it("Attachments filter excludes attachment entries when off", () => {
		const canvas = makeCanvas({
			showAttachments: false,
			searchQuery: "",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "img.png", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.some(e => e.file === "img.png")).toBe(false);
	});

	it("Tracked filter hides tracked entries when off", () => {
		const canvas = makeCanvas({
			showTrackedChanges: false,
			searchQuery: "",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "tracked" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.some(e => e.source === "tracked")).toBe(false);
		expect(out.some(e => e.file === "B.md")).toBe(true);
	});

	it("Parsed filter hides content-date entries when off", () => {
		const canvas = makeCanvas({
			showContentDates: false,
			searchQuery: "",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "tracked" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.some(e => e.source === "content")).toBe(false);
		expect(out.some(e => e.source === "tracked")).toBe(true);
	});

	it("frontmatter-derived content dates are hidden by default; showPropDates shows them", () => {
		const baseIndex = {
			"2026-01-04": [
				{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", fromFrontmatter: true },
				{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
			]
		};

		const canvasDefault = makeCanvas({
			showPropDates: false,
			searchQuery: "",
			index: baseIndex
		});
		const outDefault = getEntriesForDate(canvasDefault as any, new Date("2026-01-04T00:00:00Z"));
		expect(outDefault.some(e => e.file === "A.md")).toBe(false);
		expect(outDefault.some(e => e.file === "B.md")).toBe(true);

		const canvasProp = makeCanvas({
			showPropDates: true,
			searchQuery: "",
			index: baseIndex
		});
		const outProp = getEntriesForDate(canvasProp as any, new Date("2026-01-04T00:00:00Z"));
		expect(outProp.some(e => e.file === "A.md")).toBe(true);
		expect(outProp.some(e => e.file === "B.md")).toBe(true);
	});

	it("Hidden filter includes hidden entries when on", () => {
		const canvas = makeCanvas({
			showHidden: true,
			searchQuery: "",
			index: {
				"2026-01-04": [
				{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", reviewState: "hidden" },
				{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
			]
		}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.some(e => e.file === "A.md")).toBe(true);
	});

	it("!hidden shows only hidden entries", () => {
		const canvas = makeCanvas({
			showHidden: false,
			searchQuery: "!hidden",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", reviewState: "hidden" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.some(e => e.file === "A.md")).toBe(true);
		expect(out.some(e => e.file === "B.md")).toBe(false);
	});

	it("!similar restricts to active and related files", () => {
		const canvas = makeCanvas({
			searchQuery: "!similar",
			activeFilePath: "A.md",
			semanticRelatedPaths: new Set(["A.md", "B.md"]),
			semanticRelatedTermPaths: new Set<string>(),
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "C.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.map(e => e.file)).toEqual(["A.md", "B.md"]);
	});

	it("!similar refreshes when active file changes", () => {
		const canvas = makeCanvas({
			searchQuery: "!similar",
			activeFilePath: "A.md",
			semanticRelatedPaths: new Set(["A.md", "B.md"]),
			semanticRelatedTermPaths: new Set<string>(),
			semanticRelatedRequestId: 1,
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "C.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out1 = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out1.map(e => e.file)).toEqual(["A.md", "B.md"]);

		canvas.activeFilePath = "C.md";
		canvas.semanticRelatedPaths = new Set(["C.md"]);
		canvas.semanticRelatedRequestId = 2;

		const out2 = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out2.map(e => e.file)).toEqual(["C.md"]);
	});

	it("Draft-only filter shows only draft entries when on", () => {
		const canvas = makeCanvas({
			showHidden: true,
			showDraftOnly: true,
			searchQuery: "",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", reviewState: "draft" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.map(e => e.file)).toEqual(["A.md"]);
	});

	it("date range filter excludes days outside the range", () => {
		const canvas = makeCanvas({
			searchQuery: "2026-01-05..2026-01-05",
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.length).toBe(0);
	});
});
