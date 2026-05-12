import { describe, expect, it } from "vitest";

import { getEntriesCountForDateFast, getEntriesForDate } from "../src/ui/entry-helpers";

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: true,
		plugin: {}
	};
	return Object.assign(base, overrides);
}

describe("Epochs view bucket strictness", () => {
	it("includes epoch entries even if source is missing", () => {
		const canvas = makeCanvas({
			index: {
				"2024-01-01": [
					{
						date: "2024-01-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "",
						source: "content"
					},
					{
						date: "2024-01-01",
						file: "epoch://year/2024-01-01-2024-12-31",
						blockStart: 0,
						blockEnd: 0,
						summary: "Year summary",
						epochBucket: "year",
						epochStart: "2024-01-01",
						epochEnd: "2024-12-31"
					},
					{
						date: "2024-01-01",
						file: "epoch://month/2024-01-01-2024-01-31",
						blockStart: 0,
						blockEnd: 0,
						summary: "Month summary",
						epochBucket: "month",
						epochStart: "2024-01-01",
						epochEnd: "2024-01-31"
					}
				]
			}
		});

		const d = new Date("2024-01-01T00:00:00Z");
		const out = getEntriesForDate(canvas as any, d, { epochBucket: "year" });
		expect(out.length).toBe(1);
		expect(out[0]?.file).toContain("epoch://year/");
		const cnt = getEntriesCountForDateFast(canvas as any, d, { epochBucket: "year" });
		expect(cnt).toBe(1);
	});

	it("does not infer epochBucket from epoch:// when missing", () => {
		const canvas = makeCanvas({
			index: {
				"2025-01-01": [
					{
						date: "2025-01-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "",
						source: "content"
					},
					{
						date: "2025-01-01",
						file: "epoch://year/2025-01-01-2025-12-31",
						blockStart: 0,
						blockEnd: 0,
						summary: "Year",
						source: "epoch",
						epochStart: "2025-01-01",
						epochEnd: "2025-12-31"
					}
				]
			}
		});

		const d = new Date("2025-01-01T00:00:00Z");
		const out = getEntriesForDate(canvas as any, d, { epochBucket: "year" });
		expect(out.length).toBe(0);
		const cnt = getEntriesCountForDateFast(canvas as any, d, { epochBucket: "year" });
		expect(cnt).toBe(0);
	});
});
