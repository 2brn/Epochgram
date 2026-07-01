import { describe, expect, it } from "vitest";
import {
	isValidDailyNoteDateFormat,
	parseDateFromDailyNoteFormat,
} from "../src/utils";

describe("daily note date format", () => {
	it("accepts parseable full-date formats", () => {
		const formats = [
			"YYYY-MM-DD",
			"YY-MM-DD",
			"DD.MM.YYYY",
			"DD-MM-YY",
			"YYYY-DD-MM",
			"daily_YYDDMM",
			"daily_yyddmm",
		];
		for (const f of formats) {
			expect(isValidDailyNoteDateFormat(f)).toBe(true);
		}
	});

	it("rejects unsupported formats", () => {
		expect(isValidDailyNoteDateFormat("YYYY-MM")).toBe(false);
		expect(isValidDailyNoteDateFormat("YYYY-MM-DD-DD")).toBe(false);
		expect(isValidDailyNoteDateFormat("daily_YYDD")).toBe(false);
		expect(isValidDailyNoteDateFormat("not a format")).toBe(false);
	});

	it("parses YY-MM-DD to internal YYYY-MM-DD", () => {
		expect(parseDateFromDailyNoteFormat("26-01-06", "YY-MM-DD")).toBe("2026-01-06");
	});

	it("parses DD.MM.YYYY to internal YYYY-MM-DD", () => {
		expect(parseDateFromDailyNoteFormat("06.01.2026", "DD.MM.YYYY")).toBe("2026-01-06");
	});

	it("parses DD-MM-YY to internal YYYY-MM-DD", () => {
		expect(parseDateFromDailyNoteFormat("06-01-26", "DD-MM-YY")).toBe("2026-01-06");
	});

	it("parses YYYY-MM-DD", () => {
		expect(parseDateFromDailyNoteFormat("2026-01-06", "YYYY-MM-DD")).toBe("2026-01-06");
	});

	it("parses prefix + compact tokens", () => {
		expect(parseDateFromDailyNoteFormat("daily_260106", "daily_yyddmm")).toBe("2026-06-01");
	});

	it("parses without local Date getter dependency in moment path", () => {
		const win = window as typeof window & { moment?: unknown };
		const prevMoment = win.moment;
		const prevGetDate = Date.prototype.getDate;
		try {
			win.moment = ((input?: unknown, fmt?: string, strict?: boolean) => {
				if (typeof input === "string" && input === "2026-07-04" && fmt === "YYYY-MM-DD" && strict === true) {
					return {
						isValid: () => true,
						year: () => 2026,
						month: () => 6,
						date: () => 4,
					};
				}
				return {
					isValid: () => false,
					year: () => NaN,
					month: () => NaN,
					date: () => NaN,
				};
			}) as unknown;
			Object.defineProperty(Date.prototype, "getDate", {
				configurable: true,
				value: function getDateThrow(): number {
					throw new Error("getDate should not be called");
				},
			});
			expect(parseDateFromDailyNoteFormat("2026-07-04", "YYYY-MM-DD")).toBe("2026-07-04");
		} finally {
			Object.defineProperty(Date.prototype, "getDate", {
				configurable: true,
				value: prevGetDate,
			});
			win.moment = prevMoment;
		}
	});
});
