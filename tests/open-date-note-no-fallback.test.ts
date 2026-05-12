import { describe, expect, test, vi } from "vitest";

vi.mock("../src/ui/modals", async () => {
	return {
		FolderTreeModal: class {},
		TextPromptModal: class {},
		confirmDeleteFileIfNeeded: vi.fn(async () => false)
	};
});

vi.mock("../src/ui/epoch-canvas-helpers", async () => {
	return {
		buildNotePath: vi.fn(),
		getFileForDate: vi.fn(() => null),
		getNotePathParts: vi.fn(() => ({ folder: "", baseName: "2026-01-19" })),
		getUsableLeaf: vi.fn()
	};
});

vi.mock("../src/ui/entry-helpers", async () => {
	return {
		getEntriesForDate: vi.fn(() => [{ file: "other.md", blockStart: 0 }])
	};
});

import { openDateNote } from "../src/ui/epoch-canvas-actions";
import { getNotePathParts } from "../src/ui/epoch-canvas-helpers";

describe("openDateNote no-fallback option", () => {
	test("returns false without checking entries when allowFallbackToFirstEntry is false", async () => {
		const canvas = {} as any;
		const date = new Date("2026-01-19T00:00:00.000Z");
		const opened = await openDateNote(canvas, date, undefined, true, { allowFallbackToFirstEntry: false });
		expect(opened).toBe(false);
		expect(getNotePathParts).not.toHaveBeenCalled();
	});
});
