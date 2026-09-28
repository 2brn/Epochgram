import { describe, expect, it, vi } from "vitest";
import { focusActiveFileOrToday } from "../src/ui/epoch-canvas/active-file";

describe("focus active file or Today", () => {
	it("focuses the active file without a hover highlight", () => {
		const focusFile = vi.fn(() => true);
		const resetScrollNavToToday = vi.fn();
		const canvas = {
			activeFilePath: "notes/current.md",
			focusFile,
			resetScrollNavToToday
		};

		focusActiveFileOrToday(canvas as any);

		expect(focusFile).toHaveBeenCalledWith("notes/current.md", null, false);
		expect(resetScrollNavToToday).not.toHaveBeenCalled();
	});

	it("falls back to Today when there is no active timeline record", () => {
		const focusFile = vi.fn(() => false);
		const resetScrollNavToToday = vi.fn();
		const canvas = {
			activeFilePath: "notes/unindexed.md",
			focusFile,
			resetScrollNavToToday
		};

		focusActiveFileOrToday(canvas as any);

		expect(resetScrollNavToToday).toHaveBeenCalledTimes(1);
	});

	it("scrolls to Today when no file is open", () => {
		const focusFile = vi.fn(() => true);
		const resetScrollNavToToday = vi.fn();
		const canvas = {
			activeFilePath: null,
			focusFile,
			resetScrollNavToToday
		};

		focusActiveFileOrToday(canvas as any);

		expect(focusFile).not.toHaveBeenCalled();
		expect(resetScrollNavToToday).toHaveBeenCalledTimes(1);
	});
});
