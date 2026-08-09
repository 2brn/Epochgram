import { describe, expect, it } from "vitest";

import { getMinimalCalendarSyncPatch, isOwnedSyncFile } from "../src/plugin/calendar-sync";

describe("calendar sync minimal patch", () => {
	it("returns only the minimal required sync fields", () => {
		const managedFrontmatter = {
			source: "ics",
			date: "2026-08-12",
			uid: "event-uid",
			startIso: "2026-08-12T15:30:00.000Z",
			endIso: "2026-08-12T15:50:00.000Z",
			sourceUrl: "https://calendar.google.com",
			syncKey: "event-uid|2026-08-12T15:30:00.000Z",
			owned: true,
			lastSyncedAt: "2026-08-09T20:13:08.235Z",
			cancelled: false,
			url: "",
			location: "https://example.com",
			description: "desc",
		};

		expect(getMinimalCalendarSyncPatch(managedFrontmatter)).toEqual({
			syncKey: "event-uid|2026-08-12T15:30:00.000Z",
			startIso: "2026-08-12T15:30:00.000Z",
			uid: "event-uid",
			owned: true,
			lastSyncedAt: "2026-08-09T20:13:08.235Z",
		});
	});

	it("treats sync files without source as owned when syncKey and owned are present", () => {
		expect(isOwnedSyncFile({
			syncKey: "event-uid|2026-08-12T15:30:00.000Z",
			owned: true,
		})).toBe(true);
	});

	it("does not treat non-ics source as owned if source is present and different", () => {
		expect(isOwnedSyncFile({
			syncKey: "event-uid|2026-08-12T15:30:00.000Z",
			owned: true,
			source: "other",
		})).toBe(false);
	});
});
