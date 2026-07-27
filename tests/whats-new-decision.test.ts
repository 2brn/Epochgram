import { describe, expect, it, vi } from "vitest";

vi.mock("epochgram-whats-new-registry", () => ({
	default: {
		"1.7.0": "Sample"
	}
}));

import { resolveWhatsNewVersionToShow } from "../src/plugin/whats-new";

describe("what's new startup decision", () => {
	it("shows current version once on upgrade when page exists", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: true,
			currentVersion: "1.8.0",
			shownVersions: ["1.7.0"],
			optOut: false,
			availableVersions: ["1.8.0", "1.7.0"]
		});
		expect(next).toBe("1.8.0");
	});

	it("shows latest available page when current version has no page", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: true,
			currentVersion: "1.8.0",
			shownVersions: [],
			optOut: false,
			availableVersions: ["1.7.0"]
		});
		expect(next).toBe("1.7.0");
	});

	it("does not show future page for older current version", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: true,
			currentVersion: "1.8.0",
			shownVersions: [],
			optOut: false,
			availableVersions: ["1.9.0"]
		});
		expect(next).toBeNull();
	});

	it("shows latest available page on fresh install", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: false,
			currentVersion: "1.8.0",
			shownVersions: [],
			optOut: false,
			availableVersions: ["1.8.0", "1.7.0"]
		});
		expect(next).toBe("1.8.0");
	});

	it("respects opt-out", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: false,
			currentVersion: "1.8.0",
			shownVersions: [],
			optOut: true,
			availableVersions: ["1.8.0"]
		});
		expect(next).toBeNull();
	});

	it("does not repeat a shown version", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: true,
			currentVersion: "1.8.0",
			shownVersions: ["1.8.0"],
			optOut: false,
			availableVersions: ["1.8.0"]
		});
		expect(next).toBeNull();
	});

	it("does not show an older page when a newer version was already shown", () => {
		const next = resolveWhatsNewVersionToShow({
			hadSavedSettings: true,
			currentVersion: "1.8.0",
			shownVersions: ["1.8.0"],
			optOut: false,
			availableVersions: ["1.7.0"]
		});
		expect(next).toBeNull();
	});
});
