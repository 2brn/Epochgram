import { describe, expect, it } from "vitest";
import { isLikelyTextFilePath } from "../src/utils";
import { isAttachmentEntry } from "../src/ui/entry-helpers/shared";

describe("isLikelyTextFilePath", () => {
	it("treats epochgram-*.html exports as non-text", () => {
		expect(isLikelyTextFilePath("Daily/epochgram-2026-02-16.html")).toBe(false);
		expect(isLikelyTextFilePath("epochgram-foo.HTM")).toBe(false);
	});

	it("still treats normal html as likely text", () => {
		expect(isLikelyTextFilePath("Docs/readme.html")).toBe(true);
		expect(isLikelyTextFilePath("Docs/readme.htm")).toBe(true);
	});

	it("treats non-markdown files as attachments", () => {
		expect(isAttachmentEntry({ file: "Daily/epochgram-2026-02-16.html" } as any)).toBe(true);
		expect(isAttachmentEntry({ file: "Docs/readme.html" } as any)).toBe(true);
		expect(isAttachmentEntry({ file: "Notes/today.md" } as any)).toBe(false);
	});

	it("treats markdown as likely text", () => {
		expect(isLikelyTextFilePath("Notes/today.md")).toBe(true);
	});
});
