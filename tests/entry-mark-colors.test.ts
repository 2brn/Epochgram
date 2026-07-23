import { describe, expect, it } from "vitest";
import { getEntryMarkColor } from "../src/ui/summary-rendering/entry-mark-colors";

describe("entry mark color fallback", () => {
	it("uses default mark color for invalid explicit markColorHex", () => {
		const entry: any = { file: "a.md", date: "2026-01-01", markColorHex: "not-a-hex" };
		const palette = ["#112233", "#445566"];
		const color = getEntryMarkColor(entry, palette, "#abcdef");
		expect(color).toBe("#112233");
	});

	it("uses normalized explicit hex when valid", () => {
		const entry: any = { file: "a.md", date: "2026-01-01", markColorHex: "AABBCC" };
		const palette = ["#112233", "#445566"];
		const color = getEntryMarkColor(entry, palette, "#abcdef");
		expect(color).toBe("#aabbcc");
	});
});
