import { describe, expect, it } from "vitest";

import { getEntriesForDate } from "../src/ui/entry-helpers";

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showContentDates: true,
		showPropDates: false,
		epochsView: false,
		searchQuery: "",
		plugin: {}
	};
	return Object.assign(base, overrides);
}


describe("!marked token", () => {
	it("filters to entries with explicit markColor", () => {
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
		expect(out.length).toBe(1);
		expect(out[0]?.file).toBe("A.md");
	});

	it("includes entries when file has inherited mark", () => {
		const inherited = new Map<string, number>([["B.md", 3]]);
		const canvas = makeCanvas({
			searchQuery: "!marked",
			plugin: { __epochInheritedMarkIndexByPath: inherited },
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.length).toBe(1);
		expect(out[0]?.file).toBe("B.md");
	});

	it("does not bypass the Tracked filter", () => {
		const canvas = makeCanvas({
			searchQuery: "!marked",
			showTrackedChanges: false,
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "tracked", markColor: 2 }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-04T00:00:00Z"));
		expect(out.length).toBe(0);
	});
});
