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

describe("Filename date range filtering", () => {
	it("hides filename-range day entries when both parsed filters are off", () => {
		const rangeEntry: any = {
			date: "2026-03-07",
			file: "note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "Range day",
			source: "namedate",
			namedDateRange: true
		};
		const anchorEntry: any = {
			date: "2026-03-06",
			file: "note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "Anchor",
			source: "namedate"
		};

		const canvas = makeCanvas({
			showContentDates: false,
			showPropDates: false,
			index: {
				"2026-03-07": [rangeEntry],
				"2026-03-06": [anchorEntry]
			}
		});

		const rangeOut = getEntriesForDate(canvas as any, new Date("2026-03-07T00:00:00Z"));
		expect(rangeOut.length).toBe(0);

		const anchorOut = getEntriesForDate(canvas as any, new Date("2026-03-06T00:00:00Z"));
		expect(anchorOut.length).toBe(1);
		expect(anchorOut[0]?.source).toBe("namedate");
	});

	it("shows filename-range day entries when either parsed filter is on", () => {
		const rangeEntry: any = {
			date: "2026-03-07",
			file: "note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "Range day",
			source: "namedate",
			namedDateRange: true
		};

		const canvasPropOnly = makeCanvas({
			showContentDates: false,
			showPropDates: true,
			index: { "2026-03-07": [rangeEntry] }
		});
		const outPropOnly = getEntriesForDate(canvasPropOnly as any, new Date("2026-03-07T00:00:00Z"));
		expect(outPropOnly.length).toBe(1);

		const canvasParsedOnly = makeCanvas({
			showContentDates: true,
			showPropDates: false,
			index: { "2026-03-07": [rangeEntry] }
		});
		const outParsedOnly = getEntriesForDate(canvasParsedOnly as any, new Date("2026-03-07T00:00:00Z"));
		expect(outParsedOnly.length).toBe(1);
	});
});
