import { describe, expect, it } from "vitest";

import { getEntriesForDate } from "../src/ui/entry-helpers";

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: false,
		showPropDates: false,
		searchQuery: "",
		epochsView: false,
		plugin: {}
	};
	return Object.assign(base, overrides);
}


describe("Recurring entries respect content-date filters", () => {
	it("hides recurring entries when Content dates are off", () => {
		const canvas = makeCanvas({
			index: {
				"2026-03-01": [
					{
						date: "2026-03-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "A",
						source: "content",
						fromFrontmatter: true,
						recurring: true,
						reviewState: "reviewed"
					},
					{
						date: "2026-03-01",
						file: "B.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "B",
						source: "content",
						reviewState: "reviewed"
					},
					{
						date: "2026-03-01",
						file: "C.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "C",
						source: "dateprop",
						reviewState: "reviewed"
					}
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-03-01T00:00:00Z"));
		expect(out.map((e) => e.file).sort()).toEqual(["C.md"].sort());
	});

	it("shows recurring entries when Content dates are on (even if Prop dates are off)", () => {
		const canvas = makeCanvas({
			showContentDates: true,
			showPropDates: false,
			index: {
				"2026-03-01": [
					{
						date: "2026-03-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "A",
						source: "content",
						fromFrontmatter: true,
						recurring: true,
						reviewState: "reviewed"
					},
					{
						date: "2026-03-01",
						file: "B.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "B",
						source: "content",
						reviewState: "reviewed"
					},
					{
						date: "2026-03-01",
						file: "C.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "C",
						source: "dateprop",
						reviewState: "reviewed"
					}
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-03-01T00:00:00Z"));
		expect(out.map((e) => e.file).sort()).toEqual(["A.md", "B.md", "C.md"].sort());
	});
});
