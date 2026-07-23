import { describe, expect, it } from "vitest";
import { applyEntryState } from "../src/indexer/entry-state";

describe("entry-state mark frontmatter handling", () => {
	it("clears previous mark when next state explicitly sets empty markColorHex", () => {
		const previous: any = {
			markColor: 2,
			markColorHex: "#c14d58",
			cdate: { file: "a.md", date: "2026-01-01", source: "cdate", markColor: 2, markColorHex: "#c14d58" }
		};
		const next: any = {
			cdate: { file: "a.md", date: "2026-01-01", source: "cdate" },
			contentDates: [],
			trackedDates: {},
			markColorHex: ""
		};

		applyEntryState(previous, next);

		expect(next.markColor).toBeUndefined();
		expect(next.markColorHex).toBeUndefined();
		expect(next.cdate.markColor).toBeUndefined();
		expect(next.cdate.markColorHex).toBeUndefined();
	});

	it("still carries previous mark when next state has no explicit mark fields", () => {
		const previous: any = {
			markColor: 3,
			markColorHex: "#8b6cef"
		};
		const next: any = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [],
			trackedDates: {}
		};

		applyEntryState(previous, next);

		expect(next.markColor).toBe(3);
		expect(next.markColorHex).toBe("#8b6cef");
	});
});
