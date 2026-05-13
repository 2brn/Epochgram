import { describe, expect, it } from "vitest";

import { parseDateKey, pickEpochPeriod } from "../src/plugin/ai-summaries/shared";

describe("Epoch period alignment", () => {
	it("parses date keys with T-suffixed timestamps", () => {
		expect(parseDateKey("2020-08-21T10:30:00.123")).toBeTruthy();
		expect(parseDateKey("2020-08-21T10:30:00.123Z")).toBeTruthy();
		expect(parseDateKey("2020-08-21T10:30:00.123+03:00")).toBeTruthy();
		expect(parseDateKey("20200821T103000")).toBeTruthy();
		expect(parseDateKey("20200821T103000Z")).toBeTruthy();
		expect(parseDateKey("20200821T103000+0300")).toBeTruthy();
	});

	it("aligns 3months/6months/year to start of year (Q/H/Y)", () => {
		const d = parseDateKey("2026-02-13");
		expect(d).toBeTruthy();
		if (!d) return;

		expect(pickEpochPeriod("3months" as any, d)).toEqual({ start: "2026-01-01", end: "2026-03-31" });
		expect(pickEpochPeriod("6months" as any, d)).toEqual({ start: "2026-01-01", end: "2026-06-30" });
		expect(pickEpochPeriod("year" as any, d)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
	});

	it("aligns 3months/6months buckets in the second half of the year", () => {
		const d = parseDateKey("2026-08-13");
		expect(d).toBeTruthy();
		if (!d) return;

		expect(pickEpochPeriod("3months" as any, d)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
		expect(pickEpochPeriod("6months" as any, d)).toEqual({ start: "2026-07-01", end: "2026-12-31" });
	});
});
