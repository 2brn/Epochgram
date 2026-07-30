import { describe, expect, it } from "vitest";
import { getCalendarSyncDisplayValue, getCalendarSyncUrlRows } from "../src/settings-ui/calendar-sync-ui";

describe("calendar sync Pro UI", () => {
	it("shows blank values for non-Pro users and restores saved values when Pro is available", () => {
		expect(getCalendarSyncDisplayValue(false, "", "/Events")).toBe("");
		expect(getCalendarSyncDisplayValue(false, "/Templates", "/Events")).toBe("");
		expect(getCalendarSyncDisplayValue(true, "/Templates", "")).toBe("/Templates");
		expect(getCalendarSyncDisplayValue(true, "", "/Events")).toBe("/Events");
		expect(getCalendarSyncUrlRows(false, ["https://example.com/one.ics", "https://example.com/two.ics"])).toEqual([""]);
		expect(getCalendarSyncUrlRows(true, ["https://example.com/one.ics", "https://example.com/two.ics"])).toEqual([
			"https://example.com/one.ics",
			"https://example.com/two.ics",
			""
		]);
	});
});
