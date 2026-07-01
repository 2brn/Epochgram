import { describe, it, expect, vi } from "vitest";

import { parseAnyDate, parseAnyDates, normalizeDateFromTimestamp, computeBlocks } from "../src/indexer/extractor";
import { flattenForSummary } from "../src/indexer/flattener";

describe("DATE PARSING", () => {

    	it("parses compact YYYYMMDD with suffix", () => {
		expect(parseAnyDate("20260422-10h32")).toBe("2026-04-22");
	});

	it("parses Month DD, YYYY (US format)", () => {
		expect(parseAnyDate("April 22, 2026")).toBe("2026-04-22");
		expect(parseAnyDate("Apr 23, 2026")).toBe("2026-04-23");
		expect(parseAnyDate("April 23, 2026")).toBe("2026-04-23");
		expect(parseAnyDate("April 23 2026")).toBe("2026-04-23");
		expect(parseAnyDate("Apr 23 2026")).toBe("2026-04-23");
	});

	it("parses DD-Mon-YY with suffix", () => {
		expect(parseAnyDate("22-Apr-26-10h32")).toBe("2026-04-22");
	});

	it("parses '12th November 2025'", () => {
		const r = parseAnyDate("Meet on 12th November 2025");
		expect(r).toBe("2025-11-12");
	});

	it("parses 'November 12th, 2025'", () => {
		const r = parseAnyDate("Event: November 12th, 2025");
		expect(r).toBe("2025-11-12");
	});

	it("parses ambiguous slash 12/11/2025 as D/M/Y", () => {
		const r = parseAnyDate("Date: 12/11/2025");
		expect(r).toBe("2025-11-12");
	});

	it("extracts simple date", () => {
		const r = parseAnyDate("Event on 8/11/2025");
		expect(r).toBe("2025-11-08");
	});

    it("extracts simple date", () => {
		const r = parseAnyDate("Event on 03.4.2025");
		expect(r).toBe("2025-04-03");
	});

	it("extracts dd.mm.yy date from content", () => {
		const r = parseAnyDate("Event on 26.07.26");
		expect(r).toBe("2026-07-26");
	});

	it("parses ISO timestamps by ignoring everything after T", () => {
		expect(parseAnyDate("2020-08-21T10:30:00.123")).toBe("2020-08-21");
		expect(parseAnyDate("2020-08-21T10:30:00.123Z")).toBe("2020-08-21");
		expect(parseAnyDate("2020-08-21T10:30:00.123+03:00")).toBe("2020-08-21");
		expect(parseAnyDate("20200821T103000")).toBe("2020-08-21");
		expect(parseAnyDate("20200821T103000Z")).toBe("2020-08-21");
		expect(parseAnyDate("20200821T103000+0300")).toBe("2020-08-21");
	});

	it("ignores '6000 years ago'", () => {
		const r = parseAnyDate("Humans lived 6000 years ago");
		expect(r).toBe(null);
	});

	it("parses years > 1000 and < 2100", () => {
		expect(parseAnyDate("1001-12-31")).toBe("1001-12-31");
		expect(parseAnyDate("2099-01-01")).toBe("2099-01-01");
	});

	it("does not parse years <= 1000 or >= 2100", () => {
		expect(parseAnyDate("1000-12-31")).toBe(null);
		expect(parseAnyDate("2100-01-01")).toBe(null);
	});

	it("ignores fractional like 8/10", () => {
		const r = parseAnyDate("Handstand 8/10 times");
		expect(r).toBe(null);
	});

	it("ignores ranges 4–5", () => {
		const r = parseAnyDate("Warmup 4–5 reps");
		expect(r).toBe(null);
	});

	it("ignores time-like 02:00", () => {
		const r = parseAnyDate("At 02:00 focus");
		expect(r).toBe(null);
	});

	it("filename date parsing", () => {
		const r = parseAnyDate("Log_2025-10-31.md");
		expect(r).toBe("2025-10-31");
	});

	it("filename date range parsing", () => {
		expect(parseAnyDates("Log_2025-01-01 - 2025-01-03.md")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
	});

	it("timestamp formatting", () => {
		const d = new Date(2025, 10, 20); // 20 Nov 2025
		const r = normalizeDateFromTimestamp(+d);
		expect(r).toBe("2025-11-20");
	});

	it("no false positives in big texts", () => {
		const txt = `
			Test with 10–15° angle,
			6–8 hours of work,
			and sometimes 02:00 in the morning.
		`;
		const r = parseAnyDate(txt);
		expect(r).toBe(null);
	});

	it("extracts multiple dates within a single line", () => {
		const dates = parseAnyDates("Plan for 2025-01-05 and 07/01/2025 along with March 8, 2025 milestones");
		expect(dates).toEqual(["2025-01-05", "2025-01-07", "2025-03-08"]);
	});

	it("expands date ranges (to/until/through/till/thru)", () => {
		expect(parseAnyDates("from 2025-01-01 to 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 until 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 through 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 till 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 thru 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
	});

	it("expands date ranges (between/and)", () => {
		expect(parseAnyDates("between 2025-01-01 and 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
	});

	it("expands date ranges with punctuation connectors and extra whitespace", () => {
		expect(parseAnyDates("2025-01-01     -    2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 – 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 — 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 .. 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
		expect(parseAnyDates("2025-01-01 ... 2025-01-03")).toEqual([
			"2025-01-01",
			"2025-01-02",
			"2025-01-03"
		]);
	});

	it("expands concatenated ISO date ranges without accidental D-M-Y parse", () => {
		// This string contains the substring "02-03-2026" which must NOT be parsed as 2 March 2026.
		expect(parseAnyDates("2026-02-03-2026-02-05")).toEqual([
			"2026-02-03",
			"2026-02-04",
			"2026-02-05"
		]);
		expect(parseAnyDates("2026-02-03-2026-02-05")).not.toContain("2026-03-02");
	});

	it("ignores time ranges like 9.30-17.26", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.UTC(2026, 0, 16, 12, 0, 0)));
		const r = parseAnyDate("sun 9.30-17.26");
		expect(r).toBe(null);
		vi.useRealTimers();
	});

	it("does not infer year for month/day", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.UTC(2026, 0, 16, 12, 0, 0)));
		const r = parseAnyDate("10-11 feb - sun 9.30-17.26");
		expect(r).toBe(null);
		vi.useRealTimers();
	});

	it("parses month/day when year is explicit", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.UTC(2026, 0, 16, 12, 0, 0)));
		const r = parseAnyDate("10-11 feb 2026 - sun 9.30-17.26");
		expect(r).toBe("2026-02-10");
		vi.useRealTimers();
	});

	it("does not parse month+year without a day", () => {
		const r1 = parseAnyDate("feb 2026");
		expect(r1).toBe(null);
		const r2 = parseAnyDate("february 2026");
		expect(r2).toBe(null);
	});

	it("does not parse the 20/20/20 Formula example", () => {
		const line = "The 20/20/20 FormulaThe Victory Hour is separated into three 20-minute periods to prepare your brain and harness your power for a successful day.Period 1: Exercise from 5 a.m. to 5:20 a.m.";
		const r = parseAnyDates(line);
		expect(r).toEqual([]);
	});

	it("extracts ISO dates even when some are concatenated", () => {
		const line = "2022-02-28, 2021-09-06, 2021-08-20, 2021-06-082021-06-07, 2021-05-26, 2021-02-25, 2021-02-13, 2021-02-07, 2020-02-02, 2020-12-07";
		const r = parseAnyDates(line);
		expect(r).toEqual([
			"2022-02-28",
			"2021-09-06",
			"2021-08-20",
			"2021-06-08",
			"2021-06-07",
			"2021-05-26",
			"2021-02-25",
			"2021-02-13",
			"2021-02-07",
			"2020-02-02",
			"2020-12-07"
		]);
	});

	it("does not parse a 'date:' list as today", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.UTC(2026, 0, 16, 12, 0, 0)));
		const line = "date: 2022-02-28, 2021-09-06, 2021-08-20, 2021-06-082021-06-07, 2021-05-26, 2021-02-25, 2021-02-13, 2021-02-07, 2020-02-02, 2020-12-07";
		const r = parseAnyDates(line);
		expect(r).toEqual([
			"2022-02-28",
			"2021-09-06",
			"2021-08-20",
			"2021-06-08",
			"2021-06-07",
			"2021-05-26",
			"2021-02-25",
			"2021-02-13",
			"2021-02-07",
			"2020-02-02",
			"2020-12-07"
		]);
		expect(r).not.toContain("2026-01-16");
		vi.useRealTimers();
	});

	it("extracts a date from a git path command", () => {
		const line = "git checkout head src/data/markdown/posts/2021-09-16--september-product-update/index.md";
		const r = parseAnyDates(line);
		expect(r).toEqual(["2021-09-16"]);
	});
});


describe("SUMMARY / URL CLEANING", () => {

	it("removes MD formatting", () => {
		const r = flattenForSummary("**Bold** _italic_ text");
		expect(r).toBe("Bold italic text");
	});

	it("shortens raw URL with query", () => {
		const r = flattenForSummary("https://youtu.be/abcd1234xyz?si=AAA");
		expect(r).toBe("↗︎ youtu.be/abcd1234xyz...");
	});

	it("removes trailing slash", () => {
		const r = flattenForSummary("https://google.com/search/");
		expect(r).toBe("↗︎ google.com/search");
	});

	it("removes http/https/www", () => {
		const r = flattenForSummary("www.example.com/path");
		expect(r).toBe("↗︎ example.com/path");
	});

	it("shortens markdown links", () => {
		const r = flattenForSummary("[Open](https://youtu.be/abcd1234xyz?ref=abc)");
		expect(r).toBe("↗︎ Open youtu.be/abcd1234xyz...");
	});

	it("keeps Obsidian image filename", () => {
		const r = flattenForSummary("Hello ![[img.png]] world");
		expect(r).toBe("Hello ↗︎ img.png world");
	});

	it("removes Cyrillic tags", () => {
		const r = flattenForSummary("Текст #питання #день-1");
		expect(r).toBe("Текст");
	});

	it("preserves Cyrillic filenames with extension", () => {
		const r = flattenForSummary("Вкладення файл.тест та нотатка");
		expect(r).toBe("Вкладення файл.тест та нотатка");
	});

	it("removes punctuation outside links", () => {
		const r = flattenForSummary("Check: https://example.com/a-b-c?x=1.");
		expect(r).toBe("Check ↗︎ example.com/a-b-c...");
	});

    it("removes numbers and quotes and brackets", () => {
		const r = flattenForSummary("Check: 1.5 **(\"mâthi-môs\")**");
		expect(r).toBe("Check 1.5 mâthi-môs");
	});
});

describe("BLOCK DETECTION", () => {

	it("computes blocks separated by empty lines", () => {
		const lines = [
			"Line A",
			"Line B",
			"",
			"Line C",
			"Line D",
			"",
			"Line E"
		];

		const r = computeBlocks(lines);

		expect(r).toEqual([
			{ start: 0, end: 1 },
			{ start: 3, end: 4 },
			{ start: 6, end: 6 },
		]);
	});
});
