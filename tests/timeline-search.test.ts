import { describe, expect, it } from "vitest";
import {
	parseTimelineQuery,
	formatTimelineSearchBadge
} from "../src/ui/timeline-search";

describe("timeline search", () => {
	it("treats !tokens as normal fuzzy text", () => {
		const q = parseTimelineQuery("!marked alpha");
		expect(q.invalid).toBe(false);
		expect(q.fuzzyText).toBe("!marked alpha");
	});

	it("does not treat unknown !tokens as invalid", () => {
		const q = parseTimelineQuery("!wrong alpha");
		expect(q.invalid).toBe(false);
		expect(q.fuzzyText).toBe("!wrong alpha");
	});

	it("parses quoted phrases", () => {
		const q = parseTimelineQuery("\"alpha beta\" gamma");
		expect(q.exactPhrases).toEqual(["alpha beta"]);
		expect(q.fuzzyText).toBe("gamma");
	});

	it("parses date ranges and strips them from fuzzy text", () => {
		const q = parseTimelineQuery("2026-01-01..2026-01-02 alpha");
		expect(q.dateRange).toEqual({ start: "2026-01-01", end: "2026-01-02" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd-mm-yyyy format", () => {
		const q = parseTimelineQuery("01-02-2026 - 28-02-2026 alpha");
		expect(q.dateRange).toEqual({ start: "2026-02-01", end: "2026-02-28" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd-mm-yyyy format with dash connector (one token)", () => {
		const q = parseTimelineQuery("01-02-2026-28-02-2026 alpha");
		expect(q.dateRange).toEqual({ start: "2026-02-01", end: "2026-02-28" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd/mm/yyyy format with dots connector", () => {
		const q = parseTimelineQuery("01/02/2026..28/02/2026");
		expect(q.dateRange).toEqual({ start: "2026-02-01", end: "2026-02-28" });
		expect(q.fuzzyText).toBe("");
	});

	it("parses date ranges in yyyy.mm.dd format with dash connector", () => {
		const q = parseTimelineQuery("2026.01.01-2026.01.30 alpha");
		expect(q.dateRange).toEqual({ start: "2026-01-01", end: "2026-01-30" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd.mm.yyyy format with dash connector", () => {
		const q = parseTimelineQuery("22.02.2026-25.02.2026 alpha");
		expect(q.dateRange).toEqual({ start: "2026-02-22", end: "2026-02-25" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd.mm.yyyy format with dash connector (leap day)", () => {
		const q = parseTimelineQuery("01.02.2024-29.02.2024 alpha");
		expect(q.dateRange).toEqual({ start: "2024-02-01", end: "2024-02-29" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("does not parse invalid calendar dates in numeric one-token dash ranges", () => {
		const q = parseTimelineQuery("01.02.2026-29.02.2026 alpha");
		expect(q.dateRange).toBe(null);
	});

	it("parses date ranges in dd/mm/yyyy format with dash connector", () => {
		const q = parseTimelineQuery("22/02/2026-25/02/2026 alpha");
		expect(q.dateRange).toEqual({ start: "2026-02-22", end: "2026-02-25" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("parses date ranges in dd.mm.yy format with dash connector", () => {
		const q = parseTimelineQuery("22.02.26-25.02.26 alpha");
		expect(q.dateRange).toEqual({ start: "2026-02-22", end: "2026-02-25" });
		expect(q.fuzzyText).toBe("alpha");
	});

	it("formats badge truncated to 10 chars", () => {
		expect(formatTimelineSearchBadge("")) .toBe("");
		expect(formatTimelineSearchBadge("short")) .toBe("short");
		expect(formatTimelineSearchBadge("0123456789")) .toBe("0123456789");
		expect(formatTimelineSearchBadge("0123456789AB")) .toBe("0123456789AB");
	});
});
