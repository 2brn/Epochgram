import { describe, expect, it } from "vitest";

import { getEntriesForDate } from "../src/ui/entry-helpers";

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		showAttachments: false,
		showTrackedChanges: true,
		showHidden: false,
		showDraftOnly: false,
		showContentDates: true,
		searchQuery: "",
		epochsView: true,
		plugin: {}
	};
	return Object.assign(base, overrides);
}

describe("Epochs view respects filters", () => {
	it("hides attachment-only epochs when Attachments is off", () => {
		const canvas = makeCanvas({
			showAttachments: false,
			index: {
				"2026-01-01": [
					{
						date: "2026-01-01",
						file: "epoch://month/2026-01-01-2026-01-31",
						blockStart: 0,
						blockEnd: 0,
						summary: "Month",
						source: "epoch",
						epochBucket: "month",
						epochStart: "2026-01-01",
						epochEnd: "2026-01-31"
					}
				],
				"2026-01-10": [
					{ date: "2026-01-10", file: "Assets/img.png", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-01T00:00:00Z"));
		expect(out.length).toBe(0);
	});

	it("does not treat synthetic pinned-today clones as visible children", () => {
		const canvas = makeCanvas({
			showAttachments: false,
			index: {
				"2026-03-17": [
					{
						date: "2026-03-17",
						file: "epoch://day/2026-03-17-2026-03-17",
						blockStart: 0,
						blockEnd: 0,
						summary: "Day",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-03-17",
						epochEnd: "2026-03-17"
					},
					{
						date: "2026-03-17",
						originalDate: "2026-03-10",
						pinned: true,
						file: "Pinned.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "Pinned",
						source: "cdate"
					},
					{
						date: "2026-03-17",
						file: "epochgram-2026-03-17.html",
						blockStart: 0,
						blockEnd: 0,
						summary: "",
						source: "content"
					}
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-03-17T00:00:00Z"));
		expect(out.length).toBe(0);
	});

	it("shows attachment-only epochs when Attachments is on", () => {
		const canvas = makeCanvas({
			showAttachments: true,
			index: {
				"2026-01-01": [
					{
						date: "2026-01-01",
						file: "epoch://month/2026-01-01-2026-01-31",
						blockStart: 0,
						blockEnd: 0,
						summary: "Month",
						source: "epoch",
						epochBucket: "month",
						epochStart: "2026-01-01",
						epochEnd: "2026-01-31"
					}
				],
				"2026-01-10": [
					{ date: "2026-01-10", file: "Assets/img.png", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-01-01T00:00:00Z"));
		expect(out.length).toBe(1);
		expect(out[0]?.file).toContain("epoch://month/");
	});

	it("hides tracked-only epochs when Edits is off", () => {
		const canvas = makeCanvas({
			showTrackedChanges: false,
			index: {
				"2026-02-01": [
					{
						date: "2026-02-01",
						file: "epoch://week/2026-02-01-2026-02-07",
						blockStart: 0,
						blockEnd: 0,
						summary: "Week",
						source: "epoch",
						epochBucket: "week",
						epochStart: "2026-02-01",
						epochEnd: "2026-02-07"
					}
				],
				"2026-02-03": [
					{ date: "2026-02-03", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "tracked" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-02-01T00:00:00Z"));
		expect(out.length).toBe(0);
	});

	it("shows draft-only epochs in Draft filter mode", () => {
		const canvas = makeCanvas({
			showDraftOnly: true,
			index: {
				"2026-03-01": [
					{
						date: "2026-03-01",
						file: "epoch://day/2026-03-01-2026-03-01",
						blockStart: 0,
						blockEnd: 0,
						summary: "Day",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-03-01",
						epochEnd: "2026-03-01"
					},
					{
						date: "2026-03-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "",
						source: "content",
						reviewState: "draft"
					}
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-03-01T00:00:00Z"));
		expect(out.length).toBe(1);
	});

	it("treats !tokens as normal search text in epochs view", () => {
		const canvas = makeCanvas({
			searchQuery: "!d",
			index: {
				"2026-05-01": [
					{
						date: "2026-05-01",
						file: "epoch://day/2026-05-01-2026-05-01",
						blockStart: 0,
						blockEnd: 0,
						summary: "Day",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-05-01",
						epochEnd: "2026-05-01"
					},
					{
						date: "2026-05-01",
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "",
						source: "content",
						reviewState: "reviewed"
					}
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-05-01T00:00:00Z"));
		expect(out.length).toBe(0);
	});

	it("!similar shows only epochs that contain a semantically similar child record", () => {
		const canvas = makeCanvas({
			searchQuery: "!similar",
			semanticRelatedBasePath: "open.md",
			semanticRelatedPaths: new Set(["similar.md"]),
			index: {
				"2026-05-01": [
					{
						date: "2026-05-01",
						file: "epoch://day/2026-05-01-2026-05-01",
						blockStart: 0,
						blockEnd: 0,
						summary: "Similar epoch",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-05-01",
						epochEnd: "2026-05-01"
					},
					{ date: "2026-05-01", file: "similar.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				],
				"2026-05-02": [
					{
						date: "2026-05-02",
						file: "epoch://day/2026-05-02-2026-05-02",
						blockStart: 0,
						blockEnd: 0,
						summary: "Non-similar epoch",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-05-02",
						epochEnd: "2026-05-02"
					},
					{ date: "2026-05-02", file: "unrelated.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const day1 = getEntriesForDate(canvas as any, new Date("2026-05-01T00:00:00Z"));
		expect(day1.length).toBe(1);
		expect(day1[0]?.file).toContain("epoch://day/2026-05-01");

		const day2 = getEntriesForDate(canvas as any, new Date("2026-05-02T00:00:00Z"));
		expect(day2.length).toBe(0);
	});

	it("!similar with no open file shows all epochs", () => {
		const canvas = makeCanvas({
			searchQuery: "!similar",
			semanticRelatedBasePath: "",
			semanticRelatedPaths: new Set<string>(),
			index: {
				"2026-05-01": [
					{
						date: "2026-05-01",
						file: "epoch://day/2026-05-01-2026-05-01",
						blockStart: 0,
						blockEnd: 0,
						summary: "Day",
						source: "epoch",
						epochBucket: "day",
						epochStart: "2026-05-01",
						epochEnd: "2026-05-01"
					},
					{ date: "2026-05-01", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const out = getEntriesForDate(canvas as any, new Date("2026-05-01T00:00:00Z"));
		expect(out.length).toBe(1);
	});

});
