import { describe, expect, it } from "vitest";
import { isLikelyTextFilePath } from "../src/utils";
import { isAttachmentEntry } from "../src/ui/entry-helpers/shared";

describe("isLikelyTextFilePath", () => {
	it("treats html as likely text", () => {
		expect(isLikelyTextFilePath("Docs/readme.html")).toBe(true);
		expect(isLikelyTextFilePath("Docs/readme.htm")).toBe(true);
	});

	it("treats non-markdown files as attachments", () => {
		expect(isAttachmentEntry({ file: "Docs/readme.html" } as any)).toBe(true);
		expect(isAttachmentEntry({ file: "Notes/today.md" } as any)).toBe(false);
	});

	it("treats markdown as likely text", () => {
		expect(isLikelyTextFilePath("Notes/today.md")).toBe(true);
	});
});
